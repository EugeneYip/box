import * as THREE from 'three';
import { SEA_LEVEL } from '../../world/constants.js';
import { hashString } from '../../core/Random.js';
import { RigModel } from './RigModel.js';
import { humanModel, SKIN, HAIR, HAIR_OLD, NEUTRAL_CLOTH, TOOL_OPT, HAT_OPT, BACK_OPT } from './models/humanoid.js';
import { ANIMAL_MODELS } from './models/animals.js';
import { MONSTER_MODELS, AMBIENT_MODELS } from './models/monsters.js';
import { poseHumanoid, poseQuad, poseChicken, poseSerpent, poseWyrm } from './poses.js';
import { Overlays, DECAL, EMOTE } from './Overlays.js';
import { AmbientFauna } from './AmbientFauna.js';
import { TINY, MID } from './models/tiny.js';
import { horseModel, SADDLE_Y, SADDLE_Z } from './models/horse.js';
import { MATERIALS, WEAPON_TOOL } from '../../sim/units/items.js';
import { STATUS_BY_ID } from '../../sim/units/statuses.js';
const HAT_TINT = [null, 0xe6c870, 0xc4ccd6, 0xf2c14e, 0x5d5a3a, 0x5b3a26, null, 0xf0c030];
const SHADOW_RANGE = 60; // creatures farther than this from the camera target cast no shadow-map shadow
const LOD_HI = 52, LOD_LO = 22; // on-screen height (px) thresholds for hi / lo / tiny models

// Creature renderer (Life module). Every species is one instanced, shader-rigged
// model (see RigMaterial.js): one draw call per species plus its shadow pass.
// Sim positions are interpolated between fixed ticks; poses are procedural and
// smoothed per channel so state changes blend instead of popping.
//
// Public helpers: model(id) -> RigModel, ripple(x, z, size),
// ambient (AmbientFauna: addFlock / addSchool / scare), corpses (short-lived list).
const POSE = { humanoid: poseHumanoid, quad: poseQuad, chicken: poseChicken, serpent: poseSerpent, wyrm: poseWyrm };
const TAU = Math.PI * 2;
const EMOTE_KIND = { heart: EMOTE.heart, zzz: EMOTE.zzz, alert: EMOTE.alert, anger: EMOTE.anger, sparkle: EMOTE.sparkle, note: EMOTE.note, chat: EMOTE.chat, skull: EMOTE.skull };

function h1(n, s = 0) {
  let x = (n * 374761393 + s * 668265263) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
function lin(hex) {
  const c = new THREE.Color(hex).convertSRGBToLinear();
  return [c.r, c.g, c.b];
}
function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return a + d * t;
}
function pickWeighted(list, r) {
  let tot = 0;
  for (const e of list) tot += e[e.length - 1];
  let x = r * tot;
  for (const e of list) {
    x -= e[e.length - 1];
    if (x <= 0) return e;
  }
  return list[list.length - 1];
}
function jitter(c, r) {
  const k = 0.93 + r * 0.14;
  return [c[0] * k, c[1] * k, c[2] * k];
}
// Civilian clothing by culture (unit.data.culture); soldiers, guards and rulers
// wear their kingdom's colour, everyone else only a kingdom-coloured sash.
const CULTURE_CLOTH = {
  vale: [0xd9c9a3, 0x6f8a4e, 0xa0583a, 0xc8b27a, 0x5f7690, 0x8a6f8f, 0x7a5a3e, 0x93a47a, 0xb8a07a],
  dune: [0xe8d2a6, 0xf2ede2, 0xe0a040, 0xc0603a, 0x3c4a8a, 0x2f8a88, 0xc86a70, 0xc89040, 0xefe2c4],
  frost: [0x9a9a9e, 0x34507a, 0xe6e0d2, 0x7a2e2e, 0x3e5a4a, 0x6a5040, 0x5a5a62, 0x9ab4c8, 0xc8c0b0],
  mire: [0x6a7a3a, 0x4a6a3a, 0xa89a5a, 0x2e7a6a, 0x6a4a30, 0xb06a4a, 0x7aa04a, 0x5a4a6a, 0x8a8a50],
};
const UNIFORMED = new Set(['soldier', 'guard', 'king', 'queen']);
const WORK_JOBS = new Set(['farmer', 'woodcutter', 'miner', 'builder', 'fisher']);
// status -> emote icon (shown above creatures when close or selected)
const STATUS_ICON = { burning: EMOTE.burning, sick: EMOTE.sick, wounded: EMOTE.wounded, enraged: EMOTE.anger, frightened: EMOTE.alert, chilled: EMOTE.chilled, starving: EMOTE.starving, exhausted: EMOTE.exhausted, mourning: EMOTE.mourning, inspired: EMOTE.inspired, blessed: EMOTE.sparkle };
// shown above everyone nearby; the rest only on the selected / followed creature
const ALARM = new Set(['burning', 'sick', 'wounded', 'enraged']);
// Brighten a linear colour for far-zoom dots so it reads against terrain.
function bright(c) {
  const m = Math.max(c[0], c[1], c[2], 1e-3);
  const k = Math.max(1, 0.8 / m);
  return [Math.min(1, c[0] * k + 0.06), Math.min(1, c[1] * k + 0.06), Math.min(1, c[2] * k + 0.06)];
}
function easeOutBack(t) {
  const c1 = 1.7,
    c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

export class UnitRenderer {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.name = 'units';
    game.scene.add(this.group);
    this.defs = new Map();
    for (const d of [humanModel, horseModel, ...ANIMAL_MODELS, ...MONSTER_MODELS, ...AMBIENT_MODELS]) this.defs.set(d.id, d);
    this.models = new Map();
    this.lo = new Map();
    this.tiny = new Map();
    this.mid = new Map();
    // shared per-frame uniforms: kingdom palette (slot 1 + id % 15) and outline strength
    this._kingPal = Array.from({ length: 16 }, () => new THREE.Color(0.5, 0.5, 0.5));
    this._outlineU = { value: 0 };
    this._kingHex = new Array(16).fill(-1);
    for (const id of this.defs.keys()) this.model(id);
    this.overlays = new Overlays(game);
    this.ambient = new AmbientFauna(game, this);
    this.corpses = [];
    this.ripples = [];
    this._frustum = new THREE.Frustum();
    this._pm = new THREE.Matrix4();
    this._sph = new THREE.Sphere();
    this._m = new THREE.Matrix4();
    this._m2 = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._n = { x: 0, y: 1, z: 0 };
    this._Pt = new Float32Array(16);
    this._Pt2 = new Float32Array(16);
    // stand-in the horse is posed from (the rider's motion without the rider's chores)
    this._hu = { state: 'idle', sleeping: false, swimming: false, lastAttack: -99, activity: null, stateTime: 0, combat: null };
    this._q2 = new THREE.Quaternion();
    this._camRight = new THREE.Vector3(1, 0, 0);
    this._rimDay = new THREE.Color(1, 0.94, 0.82);
    this._rimNight = new THREE.Color(0.32, 0.42, 0.7);
    this._rim = new THREE.Color();
    this._kc = new Map();
    game.events.on('unit:death', ({ unit }) => this._onDeath(unit));
    this._kver = 0;
    game.events.on('edit', (e) => {
      if (e && e.kind === 'kingdom') this._kver++;
    });
    game.events.on('world:regenerated', () => {
      this.corpses.length = 0;
      this.ripples.length = 0;
    });
  }

  // High-detail model for an id (a low-detail twin shares its material).
  model(id) {
    let m = this.models.get(id);
    if (!m) {
      const def = this.defs.get(id);
      if (!def) return null;
      m = new RigModel(this.group, def);
      m.uniforms.uKing.value = this._kingPal;
      m.uniforms.uOutline = this._outlineU;
      this.models.set(id, m);
      this.lo.set(id, new RigModel(this.group, def, def.loDetail ?? (id === 'human' ? 0.34 : 0.45), m));
      if (TINY[id]) this.tiny.set(id, new RigModel(this.group, def, 1, m, TINY[id]));
      if (MID[id]) {
        const mm = new RigModel(this.group, def, 1, m, MID[id]);
        mm.tiny = true; // uses the hat-tinted head-top appearance
        mm.mesh.name = 'units:' + id + ':mid';
        this.mid.set(id, mm);
      }
    }
    return m;
  }
  // Pick the hi / lo twin by on-screen height in pixels (with hysteresis on rs).
  // Pick the hi / lo / tiny twin by on-screen height in pixels (hysteresis on rs.lv).
  pick(m, pxH, rs = null) {
    let lv;
    if (rs) {
      const cur = rs.lv ?? 1;
      const hiT = cur === 0 ? LOD_HI * 0.88 : LOD_HI * 1.1;
      const loT = cur === 2 ? LOD_LO * 1.15 : LOD_LO * 0.85;
      lv = pxH > hiT ? 0 : pxH > loT ? 1 : 2;
      rs.lv = lv;
    } else lv = pxH > LOD_HI ? 0 : pxH > LOD_LO ? 1 : 2;
    const id = m.def.id;
    if (lv === 2) return this.tiny.get(id) || this.lo.get(id) || m;
    return lv === 1 ? this.mid.get(id) || this.lo.get(id) || m : m;
  }
  modelFor(u) {
    if (u._rm) return u._rm;
    let m = this.models.get(u.species);
    if (!m) {
      const k = u.def.kind;
      m = this.model(k === 'humanoid' ? 'human' : u.def.habitat === 'water' ? 'serpent' : u.def.habitat === 'air' ? 'skywyrm' : k === 'monster' ? 'golem' : u.def.diet === 'carnivore' ? 'wolf' : 'sheep');
    }
    u._rm = m;
    return m;
  }

  ripple(x, z, size = 1) {
    if (this.ripples.length > 160) return;
    this.ripples.push({ x, z, t0: this.game.time.realTime, size });
  }

  // ---- appearance ------------------------------------------------------------
  _kingdomColor(k) {
    if (k == null || k < 0) return null;
    const hex = this.game.civ?.kingdomColor?.(k);
    if (hex == null) return null;
    let c = this._kc.get(hex);
    if (!c) {
      c = lin(hex).map((v) => v * 0.9);
      this._kc.set(hex, c);
    }
    return c;
  }

  _appearance(u, rs) {
    const def = u.def;
    const child = u.age < def.maturity;
    const ageB = child ? 1 : u.age > 55 ? 2 : 0;
    const ct = u.carry ? u.carry.type : null;
    const wa = u.state === 'work' ? u.data?.workAnim : null;
    const rg = !!u.data?.ranged;
    const k = rs.apK;
    const eq = u._eqVer || 0,
      nt = u.traits ? u.traits.length : 0;
    const kv = this._kver * 16777216 + (u.kingdom >= 0 ? this.game.civ?.kingdomColor?.(u.kingdom) ?? 0 : 0);
    const cb = (u.job === 'king' && !!u.combat) * 1 + (u.data?.role === 'healer') * 2; // a ruler draws the sheathed blade to fight; healers dress for it
    if (k && k.job === u.job && k.ct === ct && k.kd === u.kingdom && k.ageB === ageB && k.wa === wa && k.rg === rg && k.col === u.color && k.sex === u.sex && k.eq === eq && k.nt === nt && k.kv === kv && k.cb === cb) return;
    rs.apK = { job: u.job, ct, kd: u.kingdom, ageB, wa, rg, col: u.color, sex: u.sex, eq, nt, kv, cb };
    rs.starborn = !!u.traits?.includes('starborn');
    const id = u.id;
    const r = (k) => h1(id, k);
    const seed = r(99);
    if (def.kind === 'humanoid') return this._humanLook(u, rs, r, seed, child);
    const md = rs.model.def;
    const pal = md.palette;
    let A, B, C;
    if (pal?.combos) {
      const e = pickWeighted(pal.combos, r(1));
      A = lin(e[0]);
      B = lin(e[1]);
      C = lin(e[2] || e[1]);
    } else if (pal?.A) {
      A = lin(pickWeighted(pal.A, r(1))[0]);
      B = lin(pickWeighted(pal.B, r(2))[0]);
      C = B;
    } else {
      A = B = C = [0.8, 0.8, 0.8];
    }
    if (u.color != null) A = lin(u.color);
    // species variants (slot order follows the model's slots array)
    const slots = md.slots || [];
    const v = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (s === 'sex') v[i] = u.sex === 'm' ? 1 : 0;
      else if (s === 'antlers') v[i] = u.sex === 'm' && !child ? 1 : 0;
      else if (s === 'young') v[i] = child ? 1 : 0;
    }
    rs.ap = {
      a: jitter(A, r(3)),
      b: jitter(B, r(4)),
      c: C,
      sec: 0,
      var: [v[0] + v[1] * 16 + v[2] * 256, v[3] + v[4] * 16 + v[5] * 256, v[6] + v[7] * 16 + v[8] * 256, seed * 0.98],
    };
    rs.dot = bright(rs.ap.a);
  }

  _humanLook(u, rs, r, seed, child) {
    const female = u.sex === 'f';
    const elder = u.age > 55;
    const job = child ? 'child' : u.job;
    const anim = u.state === 'work' ? u.data?.workAnim : null;
    let skin = Math.floor(r(1) * SKIN.length);
    const cult = u.data?.culture;
    if (cult) skin = Math.max(0, Math.min(SKIN.length - 1, (hashString(String(cult)) % SKIN.length) + Math.floor(r(1) * 3) - 1));
    const hairC = elder ? HAIR_OLD[Math.floor(r(2) * HAIR_OLD.length)] : HAIR[Math.floor(r(2) * HAIR.length)];
    let hair;
    if (child) hair = female ? (r(3) < 0.5 ? 4 : 2) : r(3) < 0.6 ? 5 : 0;
    else if (female) hair = [1, 2, 4, 1, 0][Math.floor(r(3) * 5)];
    else hair = elder && r(3) < 0.55 ? 3 : r(3) < 0.12 ? 1 : 0;
    const beard = !female && !child && u.age > 19 ? (r(4) < (elder ? 0.6 : 0.3) ? 1 : r(4) < 0.5 ? 2 : 0) : 0;
    let outfit = 0;
    if (job === 'king') outfit = 2;
    else if (!child && female && r(5) < 0.55) outfit = 1;
    else if (elder && r(5) < 0.35) outfit = 2;
    let hat = HAT_OPT.none,
      tool = TOOL_OPT.none,
      offhand = 0,
      armor = 0,
      cape = 0;
    switch (job) {
      case 'farmer':
        hat = r(6) < 0.65 ? HAT_OPT.straw : HAT_OPT.none;
        tool = TOOL_OPT.hoe;
        break;
      case 'woodcutter':
        hat = r(6) < 0.6 ? HAT_OPT.hood : HAT_OPT.none;
        tool = TOOL_OPT.axe;
        break;
      case 'miner':
        hat = HAT_OPT.miner;
        tool = TOOL_OPT.pickaxe;
        break;
      case 'builder':
        hat = r(6) < 0.55 ? HAT_OPT.headband : HAT_OPT.none;
        tool = TOOL_OPT.hammer;
        break;
      case 'fisher':
        hat = r(6) < 0.65 ? HAT_OPT.oilskin : HAT_OPT.none;
        tool = TOOL_OPT.rod;
        break;
      case 'soldier':
        hat = HAT_OPT.helmet;
        tool = u.data?.ranged ? TOOL_OPT.bow : r(7) < 0.6 ? TOOL_OPT.spear : TOOL_OPT.sword;
        offhand = tool !== TOOL_OPT.bow && r(8) < 0.8 ? 1 : 0;
        armor = 1;
        outfit = 0;
        break;
      case 'king':
        hat = HAT_OPT.crown;
        tool = TOOL_OPT.scepter;
        cape = 1;
        break;
      default:
        if (!child && r(6) < 0.12) hat = HAT_OPT.hood;
    }
    if (!job || job === 'child') {
      if (anim === 'chop') tool = TOOL_OPT.axe;
      else if (anim === 'dig') tool = TOOL_OPT.pickaxe;
      else if (anim === 'hammer') tool = TOOL_OPT.hammer;
      else if (anim === 'fish') tool = TOOL_OPT.rod;
    }
    if (u.data?.ranged && tool === TOOL_OPT.none) tool = TOOL_OPT.bow;
    // healers wear a hood and a herb-green sash, and tend the sick empty-handed
    const healer = !child && (u.job === 'healer' || u.data?.role === 'healer');
    if (healer) {
      hat = HAT_OPT.hood;
      outfit = 2;
      if (anim === 'heal' || u.job === 'healer') tool = TOOL_OPT.none;
    }
    // equipment shows on the model: weapon shape, armour, material colour
    const eqp = u.equipment;
    const wpn = eqp?.weapon,
      arm = eqp?.armor;
    // a ruler at peace keeps the sceptre in hand and a legendary blade sheathed
    const sheathe = job === 'king' && wpn?.legendary && !u.combat;
    if (wpn && !child && !WORK_JOBS.has(job) && !sheathe && WEAPON_TOOL[wpn.kind] != null) {
      tool = WEAPON_TOOL[wpn.kind];
      if (tool === TOOL_OPT.bow) offhand = 0;
    }
    if (arm && !child) armor = 1;
    const metalIdx = (wpn && MATERIALS[wpn.material]?.index) || (arm && MATERIALS[arm.material]?.index) || 0;
    rs.legendary = !!(wpn?.legendary || arm?.legendary);
    rs.starsteel = wpn?.material === 'starsteel' || arm?.material === 'starsteel';
    let back = BACK_OPT[u.carry?.type] || 0;
    // a ruler at peace (or anyone working) keeps a legendary blade on the back
    if (!back && wpn?.legendary && !child && (sheathe || WORK_JOBS.has(job))) back = 5;
    rs.bladeOnBack = back === 5;
    const kc = this._kingdomColor(u.kingdom);
    const pal = CULTURE_CLOTH[u.data?.culture] || NEUTRAL_CLOTH;
    const civvies = jitter(lin(pal[Math.floor(r(9) * pal.length)]), r(12));
    // every grown member of a realm wears its colour (a little lighter or darker
    // per person); culture lives on in trousers, hats and trim
    const shade = 0.82 + r(13) * 0.32;
    const cloth = u.color != null ? lin(u.color) : kc && (!child || UNIFORMED.has(job)) ? (UNIFORMED.has(job) ? kc : kc.map((c) => Math.min(1, c * shade))) : civvies;
    const kslot = u.kingdom >= 0 ? 1 + (u.kingdom % 15) : 0;
    if (kslot && !child && cape === 0) cape = 2; // kingdom tabard: sides read at a glance
    let sec = Math.floor(r(10) * 8);
    if (job === 'soldier') sec = r(10) < 0.5 ? 1 : 7;
    if (job === 'king') sec = 5;
    if (healer) sec = 6;
    rs.tool = tool;
    rs.shield = offhand === 1;
    rs.ap = {
      a: jitter(lin(SKIN[skin]), r(11)),
      b: cloth,
      c: lin(hairC),
      sec,
      var: [hair + hat * 16 + beard * 256, tool + offhand * 16 + back * 256, cape + outfit * 16 + armor * 256 + metalIdx * 4096, kslot + seed * 0.98],
    };
    rs.dot = bright(kc || [0.85, 0.8, 0.7]);
    // tiny LOD: the head-top block shows the hat colour (or the hair)
    rs.apTiny = { ...rs.ap, b: kc && !child ? kc : rs.ap.b, c: HAT_TINT[hat] != null ? lin(HAT_TINT[hat]) : rs.ap.c };
    rs.apMid = HAT_TINT[hat] != null ? { ...rs.ap, c: lin(HAT_TINT[hat]) } : rs.ap;
  }

  _initRS(u, rm) {
    const s = h1(u.id, 7);
    return {
      model: rm,
      phase: s * 10,
      lookY: 0,
      lookP: 0,
      lookTY: 0,
      lookTP: 0,
      lookT: s * 2,
      earT: s * 3,
      earKick: 0,
      earAt: -9,
      seed: s,
      side: h1(u.id, 8) < 0.5 ? 1 : -1,
      size: 0.94 + h1(u.id, 9) * 0.12,
      P: new Float32Array(16),
      rootY: 0,
      rootPitch: 0,
      rootRoll: 0,
      rootYaw: 0,
      sY: 0,
      sPitch: 0,
      sRoll: 0,
      fwd: 0,
      k: 16,
      init: false,
      apKey: null,
      ap: null,
      tool: 0,
      shield: false,
      rippleT: s,
      step: 0,
    };
  }

  // A rider sits: thighs forward on the saddle, hands on the reins unless fighting.
  _seatRider(u, rs, ctx, P) {
    const fighting = u.state === 'attack' || ctx.now - (u.lastAttack ?? -99) < 0.55;
    P[9] = P[10] = -0.72;
    if (!fighting) {
      const gal = ctx.speed > 1.7 ? 1 : 0;
      P[0] = 0.05 + gal * 0.16;
      P[1] = 0;
      P[2] = 0;
      P[3] = -0.04 - gal * 0.12;
      P[5] = -0.6;
      P[6] = 0.08;
      P[7] = rs.tool ? -0.42 : -0.6;
      P[8] = -0.08;
    }
    rs.rootY = 0;
    rs.rootRoll = 0;
    rs.rootPitch = 0;
    rs.k = Math.max(rs.k, 18);
  }
  // Pose the horse under a rider (its own smoothed channels on rs.horse).
  _poseHorse(u, rs, ctx, skipPose, kSmooth) {
    const md = horseModel;
    let hrs = rs.horse;
    if (!hrs) hrs = rs.horse = this._initRS({ id: u.id * 7 + 13 }, null);
    if (hrs.apSrc !== rs.ap && rs.ap) {
      hrs.apSrc = rs.ap;
      const e = pickWeighted(md.palette.combos, h1(u.id, 41));
      const pants = lin(humanModel.secondary[rs.ap.sec] ?? 0x5b3a26);
      const k = Math.floor((rs.ap.var?.[3] ?? 0) + 1e-4);
      hrs.ap = { a: jitter(lin(e[0]), h1(u.id, 42)), b: lin(e[1]), c: pants, sec: 0, var: [0, 0, 0, k + hrs.seed * 0.98] };
    }
    const P2 = this._Pt2;
    if (!skipPose || !hrs.init) {
      const hu = this._hu;
      const st = u.state;
      hu.state = st === 'attack' || st === 'eat' || st === 'work' || st === 'swim' ? 'idle' : st;
      hu.stateTime = u.stateTime;
      hu.combat = u.combat;
      const run = ctx.run,
        seed = ctx.seed;
      ctx.run = ctx.speed > 1.7;
      ctx.seed = hrs.seed;
      hrs.fwd = 0;
      poseQuad(hu, hrs, ctx, P2, md);
      ctx.run = run;
      ctx.seed = seed;
      // the horse rears a little as its rider strikes
      const since = ctx.now - (u.lastAttack ?? -99);
      if (since < 0.6) {
        const p = since / 0.6;
        hrs.rootPitch -= 0.22 * Math.sin(p * Math.PI);
        P2[3] -= 0.3 * Math.sin(p * Math.PI);
      }
    } else P2.set(hrs.P);
    const Ps = hrs.P;
    if (!hrs.init) {
      Ps.set(P2);
      hrs.sY = hrs.rootY;
      hrs.sPitch = hrs.rootPitch;
      hrs.sRoll = hrs.rootRoll;
      hrs.init = true;
    } else {
      const k = kSmooth(hrs.k);
      if (!skipPose) for (let i = 0; i < 16; i++) Ps[i] += (P2[i] - Ps[i]) * k;
      hrs.sY += (hrs.rootY - hrs.sY) * k;
      hrs.sPitch += (hrs.rootPitch - hrs.sPitch) * k;
      hrs.sRoll += (hrs.rootRoll - hrs.sRoll) * k;
    }
    return hrs;
  }

  _onDeath(u) {
    const rs = u._rs;
    if (!rs || this.corpses.length > 300 || u.deathCause === 'slaughter') return;
    const g = this.game;
    let fallDir = rs.side;
    const atk = g.units.byId.get(u.data?.attacker);
    if (atk) {
      const fx = Math.sin(u.heading),
        fz = Math.cos(u.heading);
      const ax = u.x - atk.x,
        az = u.z - atk.z;
      const dot = fx * ax + fz * az;
      const cross = fx * az - fz * ax;
      fallDir = u.def.kind === 'humanoid' || u.def.brain === 'golem' ? (dot > 0 ? 1 : -1) : cross > 0 ? -1 : 1;
    }
    this.corpses.push({ u, rs, t0: g.time.total, fallDir, x: u.x, z: u.z, y: u.y, heading: u.heading, carcass: !!u.data?.carcass });
  }

  stats() {
    return this.ambient.stats();
  }

  // ---- frame ----------------------------------------------------------------
  update(dt) {
    const g = this.game;
    const U = g.units;
    const w = g.world;
    const cam = g.cameraRig.camera;
    cam.updateMatrixWorld();
    this._pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._pm);
    const H = g.pipeline?.size?.y || innerHeight;
    this._ppu = H / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)));
    const camPos = cam.position;
    const me = cam.matrixWorld.elements;
    this._camRight.set(me[0], me[1], me[2]);
    const alpha = Math.min(1, Math.max(0, (g._acc || 0) / (U.tickDt || 1 / 15)));
    const simNow = g.time.total;
    const now = simNow + (g.paused ? 0 : Math.min(g._acc || 0, U.tickDt));
    const animDt = g.paused ? 0 : Math.min(0.25, dt * g.speed);
    const idleDt = g.paused ? 0 : Math.min(dt * 2.5, animDt);
    const realNow = g.time.realTime;
    const day = g.env?.daylight ?? 1;
    this._rim.copy(this._rimNight).lerp(this._rimDay, day);
    for (const m of this.models.values()) m.setRim(this._rim);
    // kingdom palette (slot = 1 + id % 15)
    for (const k of g.civ?.kingdoms || []) {
      if (!k || k.id == null || k.color == null) continue;
      const slot = 1 + (k.id % 15);
      if (this._kingHex[slot] !== k.color) {
        this._kingHex[slot] = k.color;
        this._kingPal[slot].setHex(k.color).convertSRGBToLinear();
      }
    }
    // readability: creatures grow and gain a kingdom-coloured rim as the camera pulls back
    const camDist = g.cameraRig.cur?.dist ?? 40;
    const boost = Math.min(2.6, Math.max(1, 0.55 + camDist / 28));
    this.boost = boost;
    this._outlineU.value = smoothstep(14, 60, camDist) * 0.6;
    for (const m of this.models.values()) m.begin();
    for (const m of this.lo.values()) m.begin();
    for (const m of this.tiny.values()) m.begin();
    for (const m of this.mid.values()) m.begin();
    // animation throttling: distant and high-speed views re-pose less often
    const spd = g.paused ? 1 : g.speed || 1;
    const saver = !!g.settings?.powerSaver;
    const midEvery = (spd >= 8 ? 3 : spd >= 4 ? 2 : 1) * (saver ? 2 : 1);
    const tinyEvery = (spd >= 8 ? 5 : spd >= 4 ? 4 : 3) * (saver ? 2 : 1);
    const hiEvery = saver ? 2 : 1;
    // far zoom (game.view): creatures are drawn as dots only - no posing, no shadows
    const dotsOnly = !!(g.view?.far || (g.view?.zoom01 ?? 0) > 0.82);
    this.dotsOnly = dotsOnly;
    const camT = g.cameraRig.target;
    // held weapons and tools grow as the camera pulls back so they read at play zoom
    const weaponGrow = 0.9 * smoothstep(7, 30, g.cameraRig.cur?.dist ?? 20);
    const frame = g.frame | 0;
    const ov = this.overlays;
    ov.begin();
    const ctx = {
      now,
      simNow,
      animDt,
      idleDt,
      speed: 0,
      run: false,
      scale: 1,
      child: 0,
      seed: 0,
      visible: (x, y, z, r) => this._frustum.intersectsSphere(this._sph.set(this._p.set(x, y, z), r)),
      pixelsPerUnit: (x, y, z) => this._ppu / Math.max(0.1, camPos.distanceTo(this._p.set(x, y, z))),
      near: (x, z, r) => (camPos.x - x) ** 2 + (camPos.z - z) ** 2 < r * r,
    };
    const kSmooth = (k) => 1 - Math.exp(-dt * k);
    const P = this._Pt;
    const nrm = this._n;

    for (let li = 0; li < U.list.length; li++) {
      const u = U.list[li];
      if (!u.alive || u.data.hidden || u.data.inside === true || u.hidden || u.data.aboard != null) continue;
      const rm = this.modelFor(u);
      const md = rm.def;
      let rs = u._rs;
      if (!rs) rs = u._rs = this._initRS(u, rm);
      const def = u.def;
      // scale: species size, individual variation, growth
      const child = u.age < def.maturity ? 1 - u.age / Math.max(0.01, def.maturity) : 0;
      let scale = def.size * (u.scale || 1) * rs.size * (def.kind === 'monster' ? 1 + (boost - 1) * 0.35 : boost);
      if (def.kind === 'humanoid') scale *= 1 - 0.42 * child;
      else if (child > 0) scale *= 1 - 0.5 * Math.pow(child, 0.8);
      const ix = u.px + (u.x - u.px) * alpha,
        iz = u.pz + (u.z - u.pz) * alpha;
      const hab = def.habitat;
      const ground = w.heightAt(ix, iz);
      let y;
      if (hab === 'air') y = u.py + (u.y - u.py) * alpha;
      else if (hab === 'water') y = SEA_LEVEL;
      else if (u.swimming) y = SEA_LEVEL - (md.id === 'human' ? 0.34 : md.height * 0.5) * scale;
      else if (u.onDeck) y = Math.max(ground, SEA_LEVEL + 0.1);
      else if (u.wading) y = Math.max(ground, SEA_LEVEL - 0.18); // knee-deep at most
      else y = ground;
      this._sph.center.set(ix, y + md.height * 0.5 * scale, iz);
      this._sph.radius = md.radius * scale + 0.3;
      if (!this._frustum.intersectsSphere(this._sph)) {
        rs.init = false;
        continue;
      }
      const dCam = camPos.distanceTo(this._sph.center);
      const ppu = this._ppu / Math.max(0.1, dCam);
      const pxH = md.height * scale * ppu;
      const lod = dotsOnly ? (def.kind === 'monster' ? 1 : 0) : def.kind === 'monster' ? 1 : smoothstep(2.4, 4.6, pxH);
      if (dotsOnly && lod === 0) {
        const c = rs.dot || (this._appearance(u, rs), rs.dot) || [0.8, 0.8, 0.8];
        const dsz = Math.max(0.3, 6 / ppu) * (def.kind === 'humanoid' ? 1 : 0.8);
        ov.ground.add(ix, Math.max(ground, SEA_LEVEL), iz, dsz, 0, 1, 0, DECAL.dot, c[0], c[1], c[2], 1);
        continue;
      }
      this._appearance(u, rs);
      const heading = lerpAngle(u.ph ?? u.heading, u.heading, alpha);
      // spawn pop / emergence
      let pop = 1,
        emerge = 0;
      const age = now - u.bornAt;
      if (u.bornAt > 0.5 && age < 1.6) {
        if (def.brain === 'golem') emerge = 1 - smoothstep(0, 1.5, age);
        else if (age < 0.45) pop = Math.max(0.05, easeOutBack(age / 0.45));
      }
      const every = md.rig === 'serpent' || md.rig === 'wyrm' ? hiEvery : rs.lv === 2 ? tinyEvery : rs.lv === 1 ? midEvery : hiEvery;
      const skipPose = every > 1 && rs.init && (frame + u.id) % every !== 0;
      const riding = !!u._riding && md.id === 'human' && hab === 'land' && !u.swimming;
      let lift = 0; // a rider sits this high (world units) above the ground
      if (lod > 0.001) {
        ctx.speed = u.speedNow || 0;
        ctx.run = ctx.speed > def.speed * 1.28;
        ctx.scale = scale;
        ctx.child = def.kind === 'humanoid' ? child : 0;
        ctx.seed = rs.seed;
        // distant creatures re-pose every third frame with the accumulated time
        rs.accA = (rs.accA || 0) + animDt;
        rs.accI = (rs.accI || 0) + idleDt;
        if (!skipPose) {
          ctx.animDt = rs.accA;
          ctx.idleDt = rs.accI;
          rs.accA = rs.accI = 0;
          rs.fwd = 0;
          POSE[md.rig](u, rs, ctx, P, md);
          if (riding) this._seatRider(u, rs, ctx, P);
        } else P.set(rs.P);
        // per-channel smoothing (state changes blend instead of popping)
        const Ps = rs.P;
        if (!rs.init) {
          Ps.set(P);
          rs.sY = rs.rootY;
          rs.sPitch = rs.rootPitch;
          rs.sRoll = rs.rootRoll;
          rs.init = true;
        } else {
          const k = kSmooth(rs.k);
          if (!skipPose) for (let i = 0; i < 16; i++) Ps[i] += (P[i] - Ps[i]) * k;
          rs.sY += (rs.rootY - rs.sY) * k;
          rs.sPitch += (rs.rootPitch - rs.sPitch) * k;
          rs.sRoll += (rs.rootRoll - rs.sRoll) * k;
        }
        if (md.rig === 'humanoid' && md.id === 'human') Ps[15] = weaponGrow;
        // spine phases must not be smoothed (they grow without bound)
        if (md.rig === 'serpent' || md.rig === 'wyrm') Ps[0] = P[0];
        // terrain tilt for four-legged creatures
        let tilt = 0;
        if ((md.rig === 'quad' || md.rig === 'chicken') && !u.swimming && hab === 'land') {
          const fx = Math.sin(heading) * 0.25,
            fz = Math.cos(heading) * 0.25;
          tilt = -Math.atan2(w.heightAt(ix + fx, iz + fz) - w.heightAt(ix - fx, iz - fz), 0.5) * 0.8;
        }
        let bank = 0,
          climb = 0;
        if (hab === 'air') {
          const dh = lerpAngle(0, u.heading - (u.ph ?? u.heading), 1) / Math.max(1e-3, U.tickDt);
          rs.bank = (rs.bank || 0) + (-dh * 0.45 - (rs.bank || 0)) * kSmooth(3);
          bank = Math.max(-0.6, Math.min(0.6, rs.bank));
          climb = Math.max(-0.4, Math.min(0.4, -(u.y - (u.py ?? u.y)) / Math.max(1e-3, U.tickDt) * 0.15));
        }
        let hrs = null,
          hTilt = 0;
        if (riding) {
          const fx = Math.sin(heading) * 0.3,
            fz = Math.cos(heading) * 0.3;
          hTilt = -Math.atan2(w.heightAt(ix + fx, iz + fz) - w.heightAt(ix - fx, iz - fz), 0.6) * 0.8;
          hrs = this._poseHorse(u, rs, ctx, skipPose, kSmooth);
          lift = (SADDLE_Y + 0.035 - 0.19 + hrs.sY) * scale;
          tilt = hTilt + hrs.sPitch + hrs.P[0] * 0.6;
        }
        this._e.set(rs.sPitch + tilt + climb, heading + rs.rootYaw, rs.sRoll + bank, 'YXZ');
        this._q.setFromEuler(this._e);
        const s = scale * pop;
        const fwd = (rs.fwd + (riding ? SADDLE_Z : 0)) * scale;
        this._p.set(ix + Math.sin(heading) * fwd, y + rs.sY * scale + lift - emerge * md.height * scale, iz + Math.cos(heading) * fwd);
        this._m.compose(this._p, this._q, this._s.set(s, s, s));
        const flash = Math.max(0, 1 - (simNow - u.lastHurt) / 0.28) + (u.mad > simNow ? 0.12 + 0.08 * Math.sin(now * 7) : 0);
        let glow = u.blessed > simNow ? Math.min(1, (u.blessed - simNow) / 2) * (0.55 + 0.2 * Math.sin(now * 3 + rs.seed * 9)) : 0;
        if (rs.legendary) glow = Math.max(glow, 0.28 + 0.06 * Math.sin(now * 2 + rs.seed * 7));
        if (rs.starborn) glow = Math.max(glow, 0.12 + 0.1 * Math.sin(now * 1.7 + rs.seed * 11));
        const pm = this.pick(rm, pxH, rs);
        const near = (ix - camT.x) ** 2 + (iz - camT.z) ** 2 < SHADOW_RANGE * SHADOW_RANGE;
        const apUse = pm.tiny ? (pm.mesh.name.endsWith(':mid') ? rs.apMid : rs.apTiny) || rs.ap : rs.ap;
        pm.write(this._m, Ps, apUse, Math.min(1, flash), lod, glow, near);
        if (hrs) {
          // the horse under the rider (same heading, the rider's realm on its saddle cloth)
          this._e.set(hrs.sPitch + hTilt, heading + hrs.rootYaw, hrs.sRoll, 'YXZ');
          this._q2.setFromEuler(this._e);
          this._p.set(ix, y + hrs.sY * scale, iz);
          this._m2.compose(this._p, this._q2, this._s.set(s, s, s));
          const hm = this.pick(this._horseRM || (this._horseRM = this.model('horse')), pxH * 1.1, hrs);
          hm.write(this._m2, hrs.P, hrs.ap, Math.min(1, flash), lod, 0, near);
        }
        // a healer's touch: a soft green glint over the patient
        if (u._healAt != null && simNow - u._healAt < 1.2 && md.id === 'human' && dCam < 70) {
          const t = (now * 0.9 + rs.seed) % 1;
          const hs = Math.max(0.22 * scale, 12 / ppu) * (0.7 + 0.5 * Math.sin(t * Math.PI));
          const fade = 1 - smoothstep(0.6, 1.2, simNow - u._healAt);
          ov.emotes.add(ix, y + lift + (0.25 + t * 0.35) * scale, iz, hs, EMOTE.heal, 0.85 * fade, now);
        }
        // legendary light at the blade; starsteel and Starborn sparkle
        if ((rs.legendary || rs.starborn) && md.id === 'human') {
          const ch = Math.cos(heading),
            sh = Math.sin(heading);
          const wg = 1 + weaponGrow;
          const onBack = rs.bladeOnBack;
          const lx = onBack ? 0.0 : -0.11 * scale,
            lz = onBack ? -0.13 * scale : (0.12 + 0.22 * wg) * scale;
          const bx = ix + lx * ch + lz * sh,
            bz = iz - lx * sh + lz * ch;
          const by = y + lift + rs.sY * scale + (onBack ? 0.42 : 0.3 + 0.06 * wg) * scale;
          if (rs.legendary) {
            const pulse = 0.9 + 0.15 * Math.sin(now * 3 + rs.seed * 9);
            const gs = Math.max(0.6 * scale, 30 / ppu) * pulse;
            ov.emotes.add(bx, by, bz, gs, EMOTE.glow, 0.75, 0);
            ov.emotes.add(bx, by, bz, gs * 0.45, EMOTE.glow, 1, 0);
          }
          if (rs.starborn || rs.starsteel) {
            for (let k = 0; k < 3; k++) {
              const t = (now * 0.6 + k / 3 + rs.seed) % 1;
              const a = (k / 3) * Math.PI * 2 + now * 1.3;
              const r = 0.18 * scale;
              const cx = rs.starborn ? ix : bx,
                cz = rs.starborn ? iz : bz;
              const cy = rs.starborn ? y + rs.sY * scale + (0.1 + t * 0.55) * scale : by;
              ov.emotes.add(cx + Math.cos(a) * r, cy, cz + Math.sin(a) * r, Math.max(0.09 * scale, 7 / ppu) * Math.sin(t * Math.PI), EMOTE.star, 0.9, now * 2 + k);
            }
          }
        }
        // sea monsters at night: a soft halo at the head (photophores and fins glow on the body)
        if (md.rig === 'serpent' && day < 0.6 && dCam < 160) {
          const nk = Math.min(1, (0.6 - day) / 0.35);
          const sh = Math.sin(heading),
            chh = Math.cos(heading);
          const gs = Math.max(0.9 * scale, 26 / ppu);
          const sy = SEA_LEVEL + 0.12 * scale;
          ov.emotes.add(ix + sh * 0.55 * scale, sy + 0.1 * scale, iz + chh * 0.55 * scale, gs, EMOTE.lure, 0.7 * nk, 0);
        }
        // skywyrm fire breath
        if (md.rig === 'wyrm' && u.data?.breath > simNow) {
          this._m2.makeRotationX(0.42).setPosition(0, -0.02, 0.97);
          this._m2.premultiply(this._m);
          ov.addBreath(this._m2, Math.min(1, (u.data.breath - simNow) * 2), now);
        }
        // golem footfalls
        if (md.id === 'golem' && u.moving && dCam < 60) {
          const step = Math.floor(rs.phase / Math.PI);
          if (step !== rs.step) {
            rs.step = step;
            const sx = (step % 2 ? 0.2 : -0.2) * scale;
            g.fx.emit?.('dust', { x: ix + Math.cos(heading) * sx, y: ground, z: iz - Math.sin(heading) * sx }, { scale: 0.7 });
            if (dCam < 30) g.cameraRig.addShake?.(0.06);
          }
        }
      }
      // ---- ground decals
      if (hab === 'land' && !u.swimming) {
        if (rs.lv === 2) {
          nrm.x = 0;
          nrm.y = 1;
          nrm.z = 0;
        } else w.normalAt(ix, iz, nrm);
        const sz = ((riding ? horseModel.radius : md.radius) * 0.62 + 0.08) * scale * (u.sleeping ? 1.25 : 1);
        if (lod > 0.001) ov.ground.add(ix, ground, iz, sz * 2, nrm.x, nrm.y, nrm.z, DECAL.shadow, 0.02, 0.02, 0.05, 0.42 * lod);
      } else if (hab === 'air') {
        const gy = Math.max(ground, SEA_LEVEL);
        const altK = Math.max(0, 1 - (y - gy) / 14);
        ov.ground.add(ix, gy, iz, md.radius * 1.3 * scale * (1.4 - altK * 0.4), 0, 1, 0, DECAL.shadow, 0.02, 0.02, 0.05, 0.38 * altK);
      }
      if (u.flags?.immortal && lod > 0.05 && hab !== 'air') {
        const gy = Math.max(ground, SEA_LEVEL);
        ov.ground.add(ix, gy, iz, (md.radius * 1.2 + 0.18) * scale, 0, 1, 0, DECAL.ring, 1.0, 0.85, 0.4, 0.45 + 0.1 * Math.sin(now * 2 + rs.seed * 5));
      }
      // fighters stand on a ring of their kingdom's colour: sides read in battle
      if (u.combat && def.kind === 'humanoid' && u.kingdom >= 0 && hab === 'land') {
        const kc = this._kingdomColor(u.kingdom);
        if (kc) ov.ground.add(ix, ground, iz, (md.radius * 1.5 + 0.2) * scale, 0, 1, 0, DECAL.ring, Math.min(1, kc[0] * 1.6 + 0.1), Math.min(1, kc[1] * 1.6 + 0.1), Math.min(1, kc[2] * 1.6 + 0.1), 0.85);
      }
      if (lod < 0.999) {
        const dsz = Math.max(0.3, 6 / ppu) * (def.kind === 'humanoid' ? 1 : 0.8);
        const c = rs.dot || [0.8, 0.8, 0.8];
        ov.ground.add(ix, Math.max(ground, SEA_LEVEL), iz, dsz, 0, 1, 0, DECAL.dot, c[0], c[1], c[2], 1 - lod);
      }
      // ---- water ripples
      if ((u.swimming || (u.wading && u.moving) || hab === 'water') && dCam < 90) {
        rs.rippleT -= animDt;
        if (rs.rippleT <= 0) {
          rs.rippleT = hab === 'water' ? 0.35 : u.moving ? 0.45 : 0.9;
          if (hab === 'water') {
            const surf = u.data?.surface ?? 1;
            if (surf > 0.4) {
              const back = (0.4 + Math.random() * 2.4) * scale;
              this.ripple(ix - Math.sin(heading) * back + (Math.random() - 0.5) * 0.4, iz - Math.cos(heading) * back + (Math.random() - 0.5) * 0.4, 1.4 * scale);
            }
          } else this.ripple(ix, iz, (md.radius + 0.25) * scale * 1.6);
        }
      }
      // ---- the selected or followed creature shows its conditions at any zoom
      if ((g.selected?.ref === u || g.cameraRig.follow === u) && u.statuses && u.statuses.size) {
        const ids = [];
        for (const id of u.statuses.keys()) if (STATUS_ICON[id] != null) ids.push(id);
        ids.sort((a, b) => (STATUS_BY_ID[b]?.priority ?? 0) - (STATUS_BY_ID[a]?.priority ?? 0));
        const esz2 = Math.max(md.height * scale * 0.3, 16 / ppu);
        const top2 = y + lift + rs.sY * scale + md.height * scale + 0.15;
        for (let k = 0; k < Math.min(3, ids.length); k++) {
          const off = (k - (Math.min(3, ids.length) - 1) / 2) * esz2 * 1.1;
          ov.emotes.add(ix + this._camRight.x * off, top2 + esz2 * 0.6, iz + this._camRight.z * off, esz2, STATUS_ICON[ids[k]], 1, 0);
        }
      }
      // ---- emotes (only when close enough to read)
      if (dCam < 55 && lod > 0.3) {
        const ea = 1 - smoothstep(38, 55, dCam);
        const top = y + lift + rs.sY * scale + md.height * scale * (u.sleeping ? 0.6 : 1.05) + 0.12;
        const esz = 0.24 * Math.max(1, dCam / 22) * (def.kind === 'monster' ? 1.6 : 1);
        const em = u.emote;
        if (em && simNow < em.until) {
          const t = simNow - em.start;
          const k = Math.min(1, t / 0.25);
          const popS = easeOutBack(k);
          const fade = Math.min(1, (em.until - simNow) / 0.35);
          ov.emotes.add(ix, top + 0.08 + t * 0.05, iz, esz * popS, EMOTE_KIND[em.kind] ?? EMOTE.alert, ea * fade, Math.sin(now * 3) * 0.08);
        } else if (u.sleeping) {
          const t = (now * 0.5 + rs.seed) % 1;
          ov.emotes.add(ix + t * 0.1, top + t * 0.25, iz, esz * (0.7 + t * 0.4), EMOTE.zzz, ea * Math.sin(t * Math.PI) * 0.95, 0);
        } else if (u.mad > simNow) {
          ov.emotes.add(ix, top + 0.05, iz, esz * (0.9 + 0.12 * Math.sin(now * 8)), EMOTE.anger, ea, 0);
        }
        // status conditions: a small icon beside the head when close or selected
        if (u.statuses && u.statuses.size && dCam < 34 && !(g.selected?.ref === u || g.cameraRig.follow === u)) {
          let best = null,
            bp = -1;
          for (const id of u.statuses.keys()) {
            const pr = STATUS_BY_ID[id]?.priority ?? 0;
            if (ALARM.has(id) && pr > bp) {
              bp = pr;
              best = id;
            }
          }
          if (best) {
            const hs = Math.max(md.height * scale * 0.3, 14 / ppu);
            ov.emotes.add(ix + this._camRight.x * hs * 0.9, top - hs * 0.2, iz + this._camRight.z * hs * 0.9, hs, STATUS_ICON[best], ea * 0.95, 0);
          }
        }
      }
    }

    // ---- corpses: topple, rest, then sink and fade
    if (!dotsOnly) this._corpses(now, simNow, dt);
    // ---- projectiles
    for (const p of U.projectiles) {
      const t = Math.min(1, (p.t + alpha * U.tickDt) / p.dur);
      const x = p.x0 + (p.x1 - p.x0) * t,
        z = p.z0 + (p.z1 - p.z0) * t;
      const y = p.y0 + (p.y1 - p.y0) * t + p.arc * Math.sin(t * Math.PI);
      const dy = (p.y1 - p.y0) + p.arc * Math.PI * Math.cos(t * Math.PI);
      ov.addArrow(x, y, z, p.x1 - p.x0, dy, p.z1 - p.z0);
    }
    // ---- ambient birds & fish
    if (!dotsOnly) this.ambient.update(dt, ctx);
    // ---- ripples
    let j = 0;
    for (const r of this.ripples) {
      const t = (realNow - r.t0) / 1.6;
      if (t >= 1) continue;
      this.ripples[j++] = r;
      ov.water.add(r.x, SEA_LEVEL + 0.01, r.z, r.size * (0.35 + t * 0.9), 0, 1, 0, DECAL.ring, 0.92, 0.97, 1.0, 0.55 * (1 - t) * (1 - t), t);
    }
    this.ripples.length = j;
    for (const m of this.models.values()) m.end();
    for (const m of this.lo.values()) m.end();
    for (const m of this.tiny.values()) m.end();
    for (const m of this.mid.values()) m.end();
    ov.end(realNow);
  }

  _corpses(now, simNow, dt) {
    const g = this.game;
    const w = g.world;
    const P = this._Pt;
    let j = 0;
    for (const c of this.corpses) {
      const u = c.u;
      const rs = c.rs;
      const rm = rs.model;
      const md = rm.def;
      const td = simNow - c.t0 + (now - simNow);
      const lie = c.carcass ? 7 : 3.6;
      const sinkDur = 2.2;
      if (td > lie + sinkDur) continue;
      this.corpses[j++] = c;
      const def = u.def;
      const child = u.age < def.maturity ? 1 - u.age / Math.max(0.01, def.maturity) : 0;
      let scale = def.size * (u.scale || 1) * rs.size * (def.kind === 'monster' ? 1 + ((this.boost || 1) - 1) * 0.35 : this.boost || 1);
      if (def.kind === 'humanoid') scale *= 1 - 0.42 * child;
      else if (child > 0) scale *= 1 - 0.5 * Math.pow(child, 0.8);
      const ground = Math.max(w.heightAt(c.x, c.z), def.habitat === 'water' ? -99 : -99);
      let y = def.habitat === 'land' ? (u.swimming ? 0 - 0.3 * scale : ground) : def.habitat === 'water' ? -0.2 : c.y;
      this._sph.center.set(c.x, y, c.z);
      this._sph.radius = md.radius * scale + 0.5;
      if (!this._frustum.intersectsSphere(this._sph)) continue;
      const k = Math.min(1, td / 0.55);
      const ease = k < 1 ? k * k : 1;
      const bounce = k >= 1 ? Math.max(0, Math.sin(Math.min(1, (td - 0.55) / 0.3) * Math.PI) * 0.12 * Math.exp(-(td - 0.55) * 4)) : 0;
      const ang = (Math.PI / 2) * ease - bounce;
      P.set(rs.P);
      let pitch = 0,
        roll = 0,
        lift = 0;
      if (md.rig === 'humanoid') {
        pitch = c.fallDir * ang;
        lift = (md.id === 'golem' ? 0.36 : 0.085) * Math.abs(Math.sin(ang));
        const l = ease;
        P[6] += (0.6 - P[6]) * l;
        P[8] += (-0.6 - P[8]) * l;
        P[5] += (-0.35 - P[5]) * l;
        P[7] += (-0.25 - P[7]) * l;
        P[3] += (0.25 * c.fallDir - P[3]) * l;
        P[4] += (0.6 - P[4]) * l;
        P[9] += (-0.1 - P[9]) * l;
        P[10] += (0.15 - P[10]) * l;
        P[0] *= 1 - l;
        P[1] *= 1 - l;
      } else if (md.rig === 'quad' || md.rig === 'chicken') {
        roll = c.fallDir * ang;
        lift = (md.halfWidth || 0.1) * Math.abs(Math.sin(ang));
        const l = ease;
        P[7] += (0.3 - P[7]) * l;
        P[8] += (-0.2 - P[8]) * l;
        P[9] += (0.35 - P[9]) * l;
        P[10] += (-0.3 - P[10]) * l;
        P[3] += (0.35 - P[3]) * l;
      } else if (md.rig === 'wyrm') {
        const fall = Math.min(1, td / 1.1);
        const gy = Math.max(w.heightAt(c.x, c.z), SEA_LEVEL) + 0.15;
        y = c.y + (gy - c.y) * fall * fall;
        roll = c.fallDir * Math.min(1, td / 1.3) * 1.4;
        P[7] = 0.6;
        P[8] = -0.6;
        P[9] = 0.5;
        P[10] = -0.5;
      } else if (md.rig === 'serpent') {
        lift = -td * 0.35;
        P[3] = -0.3;
        P[2] = 0.1;
      }
      let fade = 1;
      if (td > lie) {
        const s = (td - lie) / sinkDur;
        fade = 1 - s;
        lift -= s * 0.18 * (md.height + 0.3);
      }
      this._e.set(pitch, c.heading, roll, 'YXZ');
      this._q.setFromEuler(this._e);
      this._m.compose(this._p.set(c.x, y + lift * scale, c.z), this._q, this._s.set(scale, scale, scale));
      const flash = Math.max(0, 1 - td / 0.3);
      const pxH = (md.height * scale * this._ppu) / Math.max(0.1, this.game.cameraRig.camera.position.distanceTo(this._sph.center));
      // a creature that died before it was ever drawn has no appearance yet
      if (!rs.ap) this._appearance(u, rs);
      if (!rs.ap) continue;
      this.pick(rm, pxH).write(this._m, P, rs.ap, flash, Math.max(0.001, fade), 0);
      if (def.habitat === 'land' && !u.swimming) {
        w.normalAt(c.x, c.z, this._n);
        this.overlays.ground.add(c.x, ground, c.z, (md.radius * 1.4 + 0.12) * scale, this._n.x, this._n.y, this._n.z, DECAL.shadow, 0.02, 0.02, 0.04, 0.35 * fade);
      }
    }
    this.corpses.length = j;
  }
}
