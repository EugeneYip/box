import { TILE } from '../../world/constants.js';
import { TRAITS, TRAIT_BY_ID, ANIMAL_TRAITS, BORN_TRAITS } from './traits.js';
import { STATUSES, STATUS_BY_ID } from './statuses.js';
import { makeItem as buildItem, SLOTS } from './items.js';

// Creature depth (Life module): traits, statuses, equipment, experience and
// biography. installDepth(Units) adds the public API used by Civilization,
// Effects and UI:
//   addTrait(u,id) removeTrait(u,id) hasTrait(u,id) traitMod(u,key)
//   addStatus(u,id,secs?) removeStatus(u,id) hasStatus(u,id)
//   makeItem(spec) equip(u,item) itemPower(u) addXP(u,n) log(u,text)
//   levelTitle(u)  (and TRAITS / STATUSES on game.units)
// Unit fields: traits (ids), statuses (Map id -> secs), equipment
// {weapon, armor, tool, trinket}, xp, level (1-10), title, bio [{t, text}].
// traitMod(u, key) multiplies trait and status modifiers (1 = neutral).
export const MAX_LEVEL = 10;
// L2 6, L3 21, L5 73, L7 150, L10 308: long-lived veterans reach L7+, a few heroes per century
export const xpForLevel = (l) => Math.round(6 * Math.pow(l - 1, 1.8));
const TITLES = ['the Bold', 'the Steadfast', 'the Fierce', 'the Unbroken', 'Lionheart', 'the Just', 'the Wanderer', 'the Grim', 'the Bright', 'the Iron-willed'];
const TRAIT_TITLES = { sage: 'the Wise', swift: 'the Swift', mighty: 'the Mighty', cruel: 'the Cruel', gentle: 'the Kind', valiant: 'the Valiant', starborn: 'Starchild', lucky: 'the Lucky', towering: 'the Tall', 'silver-tongued': 'Goldtongue', inventive: 'the Clever' };
const AUTO = new Set(['sleeping', 'starving', 'exhausted', 'wounded', 'frightened', 'enraged', 'blessed']);

function lawNum(game, key, def) {
  const v = game.laws?.[key];
  return typeof v === 'number' && isFinite(v) ? v : def;
}
function yearOf(game) {
  return Math.floor((game.time?.year ?? game.time.total / 30) + 1);
}

function pickTrait(rng, pool, u) {
  let tot = 0;
  for (const t of pool) tot += t.rarity;
  for (let k = 0; k < 6; k++) {
    let x = rng.next() * tot;
    for (const t of pool) {
      x -= t.rarity;
      if (x <= 0) {
        if (!u.traits.includes(t.id) && !(t.opposite && u.traits.includes(t.opposite))) return t.id;
        break;
      }
    }
  }
  return null;
}

export function installDepth(Units) {
  const P = Units.prototype;
  P.TRAITS = TRAITS;
  P.STATUSES = STATUSES;

  // ---- traits ------------------------------------------------------------
  P.hasTrait = function (u, id) {
    return !!(u && u.traits && u.traits.includes(id));
  };
  P.addTrait = function (u, id, opts = {}) {
    const t = TRAIT_BY_ID[id];
    if (!u || !t || !u.alive) return false;
    if (!opts.force && !this.law('lifeTraits')) return false;
    if (!u.traits) u.traits = [];
    if (u.traits.includes(id)) return false;
    if (t.opposite) {
      const i = u.traits.indexOf(t.opposite);
      if (i >= 0) u.traits.splice(i, 1);
    }
    u.traits.push(id);
    this._refreshMods(u);
    if (!opts.silent && u._depthReady) this.log(u, t.category === 'scar' ? `Became ${t.name.replace(/^the /, '')}` : `Gained the ${t.name} trait`);
    return true;
  };
  P.removeTrait = function (u, id) {
    if (!u?.traits) return false;
    const i = u.traits.indexOf(id);
    if (i < 0) return false;
    u.traits.splice(i, 1);
    this._refreshMods(u);
    return true;
  };
  P.traitMod = function (u, key) {
    let m = 1;
    if (u?.traits)
      for (const id of u.traits) {
        const v = TRAIT_BY_ID[id]?.mods?.[key];
        if (v != null) m *= v;
      }
    if (u?.statuses)
      for (const id of u.statuses.keys()) {
        const v = STATUS_BY_ID[id]?.mods?.[key];
        if (v != null) m *= v;
      }
    return m;
  };
  P._refreshMods = function (u) {
    u._mSpd = this.traitMod(u, 'speed');
    u._mDmg = this.traitMod(u, 'damage');
    u._mFear = this.traitMod(u, 'fear');
    u._mFert = this.traitMod(u, 'fertility');
    u._mSight = this.traitMod(u, 'sight');
    u._mAggr = this.traitMod(u, 'aggression');
    if (u._baseHp) {
      const ratio = u.maxHp > 0 ? u.hp / u.maxHp : 1;
      u.maxHp = u._baseHp * this.traitMod(u, 'hp') * (u._lvlHp || 1) * (u._blessHp || 1);
      u.hp = Math.max(0.1, Math.min(u.maxHp, ratio * u.maxHp));
    }
    if (u._baseLife) {
      let lm = 1;
      if (u.traits) for (const id of u.traits) lm *= TRAIT_BY_ID[id]?.mods?.lifespan ?? 1;
      u.lifespan = u._baseLife * lm;
    }
  };

  // ---- statuses ----------------------------------------------------------
  P.hasStatus = function (u, id) {
    return !!(u && u.statuses && u.statuses.has(id));
  };
  P.addStatus = function (u, id, seconds) {
    const s = STATUS_BY_ID[id];
    if (!u || !s || !u.alive) return false;
    if (id === 'chilled' && this.hasTrait(u, 'frostborn')) return false;
    if (id === 'sick' && this.hasTrait(u, 'plague-touched')) return false;
    let d = seconds ?? s.defaultDuration;
    if (id === 'burning' && this.hasTrait(u, 'fireheart')) d *= 0.4;
    if (!u.statuses) u.statuses = new Map();
    const had = u.statuses.has(id);
    u.statuses.set(id, Math.max(u.statuses.get(id) || 0, d));
    if (!had) this._refreshMods(u);
    return true;
  };
  P.removeStatus = function (u, id) {
    if (!u?.statuses || !u.statuses.delete(id)) return false;
    this._refreshMods(u);
    return true;
  };

  // ---- equipment ---------------------------------------------------------
  P.makeItem = function (spec = {}) {
    return buildItem({ year: yearOf(this.game), ...spec }, () => this.game.rng.next());
  };
  P.equip = function (u, item) {
    if (!u || !item || !SLOTS.includes(item.slot)) return null;
    if (!u.equipment) u.equipment = { weapon: null, armor: null, tool: null, trinket: null };
    const old = u.equipment[item.slot];
    u.equipment[item.slot] = item;
    u._eqVer = (u._eqVer || 0) + 1;
    if (item.legendary && u._depthReady) this.log(u, `Took up ${item.name}, ${item.history || 'a legendary relic'}`);
    return old || null;
  };
  P.itemPower = function (u) {
    const e = u?.equipment;
    if (!e) return 0;
    return (e.weapon?.power || 0) + (e.armor?.power || 0) + (e.tool?.power || 0) + (e.trinket?.power || 0);
  };

  // ---- experience & biography ---------------------------------------------
  P.log = function (u, text) {
    if (!u || !text) return;
    if (!u.bio) u.bio = [];
    u.bio.push({ t: this.game.time.total, text });
    if (u.bio.length > 24) u.bio.splice(0, u.bio.length - 24);
  };
  P.levelTitle = function (u) {
    if (!u || (u.level || 1) < 7) return '';
    if (!u.title) {
      const tt = (u.traits || []).map((id) => TRAIT_TITLES[id]).find(Boolean);
      u.title = tt || TITLES[u.id % TITLES.length];
    }
    return u.title;
  };
  P.addXP = function (u, n) {
    if (!u || !u.alive || !(n > 0) || !this.law('lifeExperience')) return;
    u.xp = (u.xp || 0) + n;
    while ((u.level || 1) < MAX_LEVEL && u.xp >= xpForLevel((u.level || 1) + 1)) {
      u.level = (u.level || 1) + 1;
      u._lvlHp = 1 + (u.level - 1) * 0.06;
      this._refreshMods(u);
      u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.25);
      if (u.def.kind === 'humanoid' || u.def.kind === 'monster') {
        if (u.level === 7) this.log(u, `Became known as ${u.name || u.def.name} ${this.levelTitle(u)}`);
        else if (u.level >= 3) this.log(u, `Reached level ${u.level}`);
      }
      if (u.level >= MAX_LEVEL) this.addTrait(u, 'hero', { force: true });
      // great deeds turn up great weapons
      if (u.level >= 8 && u.def.kind === 'humanoid' && !u.equipment?.weapon?.legendary && this.law('lifeEquipment') && this.game.rng.chance(0.35)) {
        const v = this.game.civ?.villages?.[u.village];
        const kinds = ['sword', 'axe', 'spear', 'mace'];
        const it = this.makeItem({ slot: 'weapon', kind: kinds[u.id % kinds.length], material: this.game.rng.chance(0.3) ? 'starsteel' : 'steel', quality: 'legendary', origin: v?.name });
        this.equip(u, it);
      }
    }
  };

  // ---- lifecycle hooks (called by Units) ------------------------------------
  P._depthSpawn = function (u, opts) {
    const g = this.game;
    const rng = g.rng;
    u.traits = [];
    u.statuses = new Map();
    u.equipment = { weapon: null, armor: null, tool: null, trinket: null };
    u.bio = [];
    u.xp = 0;
    u.level = 1;
    u._baseHp = u.maxHp;
    u._baseLife = u.lifespan;
    const def = u.def;
    // beasts and monsters: ferocity law
    if ((def.kind === 'monster' || (def.kind === 'animal' && def.diet !== 'herbivore')) && lawNum(g, 'beastsFerocity', 1) !== 1) u._baseHp *= lawNum(g, 'beastsFerocity', 1);
    // parents: given, or (for newborn villagers) the nearest grown couple of the village
    let parents = opts.parents || null;
    if (!parents && def.kind === 'humanoid' && (opts.age ?? 1) < 1) {
      const mom = this.nearest(u.x, u.z, 2, (o) => o.species === 'human' && o.sex === 'f' && o.age >= 16 && o !== u);
      const sp = mom?.data?.civ?.spouse;
      const dad = (sp != null && this.byId.get(sp)) || this.nearest(u.x, u.z, 6, (o) => o.species === 'human' && o.sex === 'm' && o.age >= 16 && o.village === u.village && o !== u);
      parents = [mom, dad].filter(Boolean);
      for (const p of parents) if (!p._parentLogged) {
        p._parentLogged = true;
        this.log(p, `Became a parent`);
      }
    }
    if (this.law('lifeTraits') && def.kind !== 'monster') {
      if (parents && parents.length && this.law('lifeInheritance')) {
        const seen = new Map();
        for (const p of parents)
          for (const id of p.traits || []) {
            const t = TRAIT_BY_ID[id];
            if (t && t.category !== 'scar') seen.set(id, (seen.get(id) || 0) + 1);
          }
        for (const [id, n] of seen) if (rng.chance(n >= 2 || parents.length === 1 ? 0.65 : 0.4)) this.addTrait(u, id, { silent: true });
        const pool = def.kind === 'humanoid' ? BORN_TRAITS : BORN_TRAITS.filter((t) => ANIMAL_TRAITS.includes(t.id));
        // mutation, and most children are born with something of their own
        if (rng.chance(0.18) || (!u.traits.length && rng.chance(def.kind === 'humanoid' ? 0.5 : 0.2))) {
          const id = pickTrait(rng, pool, u);
          if (id) this.addTrait(u, id, { silent: true });
        }
      } else if (def.kind === 'humanoid') {
        if (rng.chance(0.6)) {
          const id = pickTrait(rng, BORN_TRAITS, u);
          if (id) this.addTrait(u, id, { silent: true });
        }
        if (rng.chance(0.25)) {
          const id = pickTrait(rng, BORN_TRAITS, u);
          if (id) this.addTrait(u, id, { silent: true });
        }
      } else if (rng.chance(0.22)) {
        const id = pickTrait(rng, BORN_TRAITS.filter((t) => ANIMAL_TRAITS.includes(t.id)), u);
        if (id) this.addTrait(u, id, { silent: true });
      }
    }
    this._refreshMods(u);
    u.hp = u.maxHp;
    if (def.kind === 'humanoid') {
      const vname = g.civ?.villages?.[u.village]?.name;
      const names = parents && parents.length ? ` to ${parents.map((p) => p.name).join(' and ')}` : '';
      this.log(u, (opts.age ?? 1) < 1 ? `Born${vname ? ' in ' + vname : ''}${names}` : `Arrived${vname ? ' in ' + vname : ''}`);
    } else if (def.kind === 'monster') this.log(u, 'Awoke from the deep wilds');
    u._depthReady = true;
  };

  P._depthDeath = function (u, cause, killer) {
    const g = this.game;
    if (u.def.kind !== 'animal') {
      const age = Math.floor(u.age);
      const why = cause === 'old age' ? 'of old age' : cause === 'starvation' ? 'of hunger' : cause === 'fire' ? 'in the flames' : cause === 'drowned' ? 'by drowning' : killer ? `at the hands of ${killer.name || 'a ' + killer.def.name.toLowerCase()}` : `(${cause})`;
      this.log(u, `Died ${why}, aged ${age}`);
    }
    // a widow or widower outlives their spouse
    const sp = u.data?.civ?.spouse;
    if (sp != null && u.def.kind === 'humanoid') {
      const s = this.byId.get(sp);
      if (s && s.alive) {
        this.log(s, `Outlived ${u.name}`);
        this.addStatus(s, 'mourning', 40);
      }
    }
    if (killer && killer.alive) {
      if (killer.def.kind === 'humanoid' && (killer.kills || 0) <= 1) this.log(killer, `First kill: ${u.name || 'a ' + u.def.name.toLowerCase()}`);
      else if (killer.def.kind === 'humanoid' && u.def.kind === 'animal' && u.def.diet !== 'herbivore' && u.def.mass >= 1) this.log(killer, `Hunted down a ${u.def.name.toLowerCase()}`);
      this.addXP(killer, Math.max(2, u.maxHp * 0.3));
      if (killer.def.kind === 'humanoid') {
        if ((killer.kills || 0) >= 10 && !this.hasTrait(killer, 'veteran')) this.addTrait(killer, 'veteran');
        if (u.def.kind === 'humanoid' && u.kingdom >= 0 && u.kingdom === killer.kingdom && !(killer.mad > g.time.total)) this.addTrait(killer, 'kinslayer');
        if (u.def.kind === 'monster') this.log(killer, `Slew ${u.name || 'a ' + u.def.name}`);
      }
    }
    // gear: a killer takes legendary relics; otherwise it goes to the village stores
    const e = u.equipment;
    if (e) {
      for (const slot of SLOTS) {
        const it = e[slot];
        if (!it) continue;
        if (killer && killer.alive && killer.def.kind === 'humanoid' && (it.legendary || !killer.equipment?.[slot])) {
          this.equip(killer, it);
          if (it.legendary) this.log(killer, `Claimed ${it.name} from ${u.name || 'a fallen foe'}`);
        } else g.civ?.depositItem?.(u.village, it, u);
      }
    }
  };

  // Status upkeep (about once a second per unit).
  P._depthStatusTick = function (u, dt, now) {
    const g = this.game;
    const S = u.statuses;
    if (!S) return;
    let changed = false;
    for (const [id, left] of S) {
      if (left === Infinity) continue;
      const l = left - dt;
      if (l <= 0) {
        S.delete(id);
        changed = true;
      } else S.set(id, l);
    }
    // conditions mirrored as statuses
    const want = {
      sleeping: !!u.sleeping || u.state === 'sleep',
      starving: u.hunger > 0.9 && this.law('lifeHunger'),
      exhausted: u.energy < 0.12,
      wounded: u.hp < u.maxHp * 0.35,
      frightened: u.state === 'flee',
      enraged: u.mad > now,
      blessed: u.blessed > now,
    };
    for (const id of AUTO) {
      const on = want[id];
      const has = S.has(id);
      if (on && !has) {
        S.set(id, id === 'enraged' || id === 'blessed' || id === 'frightened' ? Math.max(1, (id === 'enraged' ? u.mad : id === 'blessed' ? u.blessed : now + 3) - now) : Infinity);
        changed = true;
        if (id === 'wounded') u._woundLow = u.hp / u.maxHp;
      } else if (!on && has && S.get(id) === Infinity) {
        S.delete(id);
        changed = true;
        // a terrible wound that healed leaves a scar
        if (id === 'wounded' && u.alive && (u._woundLow ?? 1) < 0.2 && u.def.kind === 'humanoid' && g.rng.chance(0.35)) this.addTrait(u, 'scarred');
      }
      if (id === 'wounded' && on) u._woundLow = Math.min(u._woundLow ?? 1, u.hp / u.maxHp);
    }
    // cold ages bite on snow and ice
    const temp = g.age?.mods?.temperature ?? 0;
    if (temp < -0.1 && u.def.habitat === 'land') {
      const w = g.world;
      const t = w.type[Math.min(w.h - 1, Math.max(0, u.z | 0)) * w.w + Math.min(w.w - 1, Math.max(0, u.x | 0))];
      if (t === TILE.SNOW || t === TILE.ICE || (t === TILE.TUNDRA && temp < -0.25)) {
        if (this.addStatus(u, 'chilled', 6)) changed = changed || false;
      }
    }
    // standing in fire
    if (u.def.habitat === 'land') {
      const w = g.world;
      const i = Math.min(w.h - 1, Math.max(0, u.z | 0)) * w.w + Math.min(w.w - 1, Math.max(0, u.x | 0));
      if (w.fire[i] > 0.3 && !S.has('burning')) {
        this.addStatus(u, 'burning', 3);
      }
    }
    if (u.def.kind === 'humanoid') {
      const yr = Math.floor(u.age);
      if (u._yr == null) u._yr = yr;
      if (yr > u._yr) {
        u._yr = yr;
        if (u.age >= u.def.maturity) this.addXP(u, u.job === 'soldier' ? 2 : 1);
        if (yr === 50 || yr === 70 || yr === 90) this.log(u, `Turned ${yr}`);
        const v = g.civ?.villages?.[u.village];
        if (v?.starving) u._famine = v.name || true;
        else if (u._famine) {
          this.log(u, `Survived the famine${typeof u._famine === 'string' ? ' in ' + u._famine : ''}`);
          this.addXP(u, 6);
          u._famine = null;
        }
      }
    }
    if (S.has('burning')) this.damage(u, dt * 4, null, { cause: 'fire' });
    if (S.has('sick') && u.alive) u.hp = Math.max(0.5, u.hp - dt * 0.15);
    if (changed) this._refreshMods(u);
  };
}
