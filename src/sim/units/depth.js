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

// How each cause of death reads in a life story ("Died ...").
const DEATH_WORDS = {
  'old age': 'of old age',
  starvation: 'of hunger',
  fire: 'in the flames',
  lava: 'in molten rock',
  drowned: 'by drowning',
  plague: 'of the plague',
  sickness: 'of a fever',
  wounds: 'of their wounds',
  killed: 'in a fight',
  arrow: 'by an arrow',
  executed: "at the executioner's block",
  meteor: 'beneath a falling star',
  lightning: 'struck by lightning',
  smite: 'smitten by the gods',
  divine: 'by the will of the gods',
  removed: 'taken by the gods',
  earthquake: 'in an earthquake',
  tornado: 'in a whirlwind',
  flood: 'in a flood',
  tsunami: 'beneath a great wave',
  storm: 'in a storm',
  cold: 'of the cold',
  ship: 'in a sea fight',
  stranded: 'stranded ashore',
  explosion: 'in a blast',
  acid: 'in acid rain',
  curse: 'under a curse',
  disaster: 'in a disaster',
  golem: 'crushed by a golem',
  damage: 'of their wounds',
};

// Odds of being born with a gift of one's own (one, then a second): about half
// the people carry a trait from birth, a little more where traits are inherited;
// deeds and hardships add the rest over a lifetime (~60-70% in all).
const BORN_ONE = 0.46,
  BORN_TWO = 0.15;

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
  // Living legends: counted from equipment, refreshed every 20 s.
  P._legends = function () {
    const now = this.game.time.total;
    let c = this._legendCache;
    if (c && now - c.t < 20) return c;
    c = { t: now, names: new Set(), count: 0, realm: new Map(), heroes: 0 };
    for (const u of this.list) {
      if (u.traits && u.traits.includes('hero')) c.heroes++;
      const e = u.equipment;
      if (!e) continue;
      for (const slot of SLOTS) {
        const it = e[slot];
        if (it && it.legendary) {
          c.count++;
          c.names.add(it.name);
          c.realm.set(u.kingdom, (c.realm.get(u.kingdom) || 0) + 1);
        }
      }
    }
    this._legendCache = c;
    return c;
  };
  // Legends stay rare: a handful per century world-wide, at most two per realm
  // at once, and every living legend has a unique name.
  P.makeItem = function (spec = {}) {
    const g = this.game;
    const s = { year: yearOf(g), ...spec };
    if (s.quality === 'legendary') {
      const L = this._legends();
      const now = g.time.total;
      const cap = Math.max(3, Math.round(3 * this.popScale));
      const realmFull = s.kingdom != null && s.kingdom >= 0 && (L.realm.get(s.kingdom) || 0) >= 2;
      if (!s.divine && (L.count >= cap || realmFull || now - (this._lastLegend ?? -1e9) < 450)) {
        s.quality = 'masterwork';
        if (s.material === 'starsteel') s.material = 'steel';
      } else {
        this._lastLegend = now;
        s.taken = L.names;
      }
    }
    const it = buildItem(s, () => g.rng.next());
    if (it.legendary) {
      const L = this._legends();
      L.names.add(it.name);
      L.count++;
      if (s.kingdom != null) L.realm.set(s.kingdom, (L.realm.get(s.kingdom) || 0) + 1);
    }
    return it;
  };
  // More heroes on bigger, more populous worlds (about one per 250 people).
  P.heroCap = function () {
    const humans = this._counts?.get('human') || 0;
    return Math.max(3, Math.round(2 + 2 * this.popScale + humans / 250));
  };
  // Every realm of some size raises a champion: when it has no living hero,
  // its most seasoned veteran is hailed (checked about once a game minute).
  P._championsTick = function () {
    if (!this.law('lifeExperience')) return;
    const g = this.game;
    const L = this._legends();
    if (L.heroes >= this.heroCap()) return;
    const best = new Map(),
      size = new Map(),
      has = new Set();
    for (const u of this.list) {
      if (!u.alive || u.species !== 'human' || !(u.kingdom >= 0)) continue;
      size.set(u.kingdom, (size.get(u.kingdom) || 0) + 1);
      if (u.traits.includes('hero')) has.add(u.kingdom);
      if (u.level < 7 || u.data.civ?.royal) continue;
      const deeds = (u.kills || 0) * 2 + (u._battles || 0);
      if (u.level < 8 && deeds < 14) continue;
      const score = u.level * 10 + deeds;
      const b = best.get(u.kingdom);
      if (!b || score > b.s) best.set(u.kingdom, { u, s: score });
    }
    let n = L.heroes;
    for (const [k, b] of best) {
      if (n >= this.heroCap()) break;
      if (has.has(k) || (size.get(k) || 0) < 30) continue;
      const realm = g.civ?.kingdomName?.(k) || 'the realm';
      if (this.tryHero(b.u, `Hailed as the champion of ${realm}`)) n++;
    }
  };
  // Hero: a deed worthy of song (respecting a cap on living heroes).
  P.tryHero = function (u, deed) {
    if (!u || !u.alive || u.def.kind !== 'humanoid' || this.hasTrait(u, 'hero')) return false;
    const L = this._legends();
    if (L.heroes >= this.heroCap()) return false;
    if (this.addTrait(u, 'hero')) {
      L.heroes++;
      if (deed) this.log(u, deed);
      return true;
    }
    return false;
  };
  P.equip = function (u, item) {
    if (!u || !item || !SLOTS.includes(item.slot)) return null;
    if (!u.equipment) u.equipment = { weapon: null, armor: null, tool: null, trinket: null };
    const old = u.equipment[item.slot];
    u.equipment[item.slot] = item;
    u._eqVer = (u._eqVer || 0) + 1;
    if (item.legendary) this._legendCache = null;
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
    // a life story never repeats the same line
    for (let i = u.bio.length - 1; i >= 0; i--) if (u.bio[i].text === text) return;
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
    // deeds weigh a little more on a bigger world (Medium x1, Huge x1.26, World Map up to x1.5)
    if (n > 0 && u.def.kind === 'humanoid') n *= Math.min(1.5, Math.max(1, Math.sqrt(this.popScale)));
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
      if (u.level >= 9) this.tryHero(u, 'Hailed as a hero of the realm');
      // great deeds turn up great weapons
      if (u.level >= 8 && u.def.kind === 'humanoid' && !u.equipment?.weapon?.legendary && this.law('lifeEquipment') && this.game.rng.chance(0.35)) {
        const v = this.game.civ?.villages?.[u.village];
        const kinds = ['sword', 'axe', 'spear', 'mace'];
        const it = this.makeItem({ slot: 'weapon', kind: kinds[u.id % kinds.length], material: this.game.rng.chance(0.3) ? 'starsteel' : 'steel', quality: 'legendary', origin: v?.name, kingdom: u.kingdom });
        if (it.legendary) {
          this.equip(u, it);
          this.log(u, `Found the legendary ${it.name}`);
        } else if (!u.equipment?.weapon || (u.equipment.weapon.power || 0) < it.power) this.equip(u, it);
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
        for (const [id, n] of seen) if (rng.chance(n >= 2 || parents.length === 1 ? 0.42 : 0.18)) this.addTrait(u, id, { silent: true });
        const pool = def.kind === 'humanoid' ? BORN_TRAITS : BORN_TRAITS.filter((t) => ANIMAL_TRAITS.includes(t.id));
        // a child is born with something of its own as often as without inheritance
        // (inheritance only ever adds the parents' gifts on top), plus a rare mutation
        const own = def.kind === 'humanoid' ? [BORN_ONE, BORN_TWO] : [0.2, 0];
        if (!u.traits.length && rng.chance(own[0])) {
          const id = pickTrait(rng, pool, u);
          if (id) this.addTrait(u, id, { silent: true });
        }
        if (u.traits.length < 2 && rng.chance(Math.max(own[1], 0.06))) {
          const id = pickTrait(rng, pool, u);
          if (id) this.addTrait(u, id, { silent: true });
        }
      } else if (def.kind === 'humanoid') {
        if (rng.chance(BORN_ONE)) {
          const id = pickTrait(rng, BORN_TRAITS, u);
          if (id) this.addTrait(u, id, { silent: true });
        }
        if (rng.chance(BORN_TWO)) {
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
    if (def.kind === 'humanoid' && u.name && u.kingdom >= 0) {
      // namesakes in one realm get a numeral (Aldric, Aldric II, ...)
      let n = 0;
      for (const o of this.list) if (o.alive && o.kingdom === u.kingdom && o.species === 'human' && o.name && (o.name === u.name || o.name.startsWith(u.name + ' '))) n++;
      if (n > 0) u.name = `${u.name} ${['II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][Math.min(8, n - 1)]}`;
    }
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
      let why = DEATH_WORDS[cause];
      if (killer) {
        const realm = killer.def.kind === 'humanoid' && killer.kingdom >= 0 && killer.kingdom !== u.kingdom ? g.civ?.kingdomName?.(killer.kingdom) : null;
        why = `${cause === 'arrow' ? 'by an arrow from' : 'at the hands of'} ${killer.name || 'a ' + killer.def.name.toLowerCase()}${realm ? ' of ' + realm : ''}`;
      }
      if (!why) why = `of ${String(cause || 'unknown causes').replace(/_/g, ' ')}`;
      this.log(u, `Died ${why}, aged ${age}`);
      u.deathCause = cause;
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
        if (u.def.kind === 'monster') {
          this.log(killer, `Slew ${u.name || 'a ' + u.def.name}`);
          this.tryHero(killer, `Hailed as a hero for slaying ${u.name || 'a monster'}`);
        }
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
