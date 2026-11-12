import { HERALDRY, colorDist, baseCulture } from './cultures.js';
import { relKey } from './politics.js';
import { BUILDING_TYPES } from './catalog.js';
import { YEAR, ADULT_AGE } from './util.js';

// Player editing of kingdoms, villages and cultures (contract: docs/EDITING.md).
// Every successful edit returns true, emits game.events 'edit'
// { kind, id, key, value }, writes a chronicle line where it matters, bumps the
// version counters renderers watch, and is marked in `player` so the
// simulation never overwrites it.

// Emblems for banners (drawn by src/render/buildings/emblems.js).
export const BANNER_SYMBOLS = ['tower', 'wheat', 'wolf', 'star', 'wave', 'oak', 'flame', 'crown', 'anvil', 'ship', 'moon', 'eye', 'key', 'sun', 'mountain', 'stag'];
// Field patterns: the banner's cloth split between the realm's colour and a darker shade.
export const BANNER_FIELDS = ['plain', 'pale', 'bend', 'chevron', 'quartered'];
const FIELD_ALIAS = { 'per pale': 'pale', 'per bend': 'bend', perpale: 'pale', perbend: 'bend' };

// emblems each people reaches for first when it raises a banner
const CULTURE_SYMBOLS = {
  vale: ['wheat', 'oak', 'tower', 'stag', 'crown', 'key'],
  dune: ['sun', 'star', 'eye', 'ship', 'flame', 'moon'],
  frost: ['wolf', 'mountain', 'anvil', 'ship', 'wave', 'moon'],
  mire: ['moon', 'eye', 'wave', 'flame', 'oak', 'stag'],
};

const POLICY_KEYS = {
  expansion: { law: 'civExpansion', type: 'bool' },
  warlike: { law: 'diploWarlike', type: 'num', min: 0, max: 3, def: 1 },
  rebellions: { law: 'civRebellions', type: 'bool' },
  technology: { law: 'civTechnology', type: 'bool' },
  growth: { law: 'civGrowth', type: 'num', min: 0.25, max: 3, def: 1 },
  lockDiplomacy: { law: null, type: 'bool', def: false },
};
const VPOLICY_KEYS = { walls: 'bool', growth: 'num', buildings: 'bool', capital: 'bool' };

const cleanName = (s, max) => {
  if (typeof s !== 'string') return null;
  // printable characters only, collapsed whitespace
  const t = s.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  return t.length >= 1 && t.length <= max ? t : null;
};

export const editing = {
  BANNER_SYMBOLS,
  BANNER_FIELDS,

  _edited(kind, id, key, value) {
    this.colorVersion++;
    this.version++;
    this.game.events?.emit?.('edit', { kind, id, key, value });
    return true;
  },
  _mark(o, key) {
    (o.player || (o.player = {}))[key] = true;
  },
  _liveKingdom(id) {
    const k = this.kingdoms[id];
    return k && k.alive ? k : null;
  },

  // ------------------------------------------------------------ kingdoms
  renameKingdom(id, name) {
    const k = this._liveKingdom(id);
    const n = cleanName(name, 32);
    if (!k || !n) return false;
    if (n === k.name) return true;
    const old = k.name;
    k.name = n;
    k.base = n;
    this._mark(k, 'name');
    this._history(`${/^the /i.test(old) ? old : 'The ' + old} shall now be known as ${n}.`, 'info', this._kingdomPos?.(k));
    return this._edited('kingdom', id, 'name', n);
  },

  setKingdomColor(id, hex) {
    const k = this._liveKingdom(id);
    if (!k || !Number.isInteger(hex) || hex < 0 || hex > 0xffffff) return false;
    k.color = hex;
    const h = HERALDRY.find((t) => t.color === hex);
    k.colorName = h ? h.name : 'a tincture of its own';
    this._mark(k, 'color');
    return this._edited('kingdom', id, 'color', hex);
  },

  // Twelve tinctures that keep their distance from the realm's neighbours
  // (and from every other living realm), best first.
  kingdomColorSuggestions(id) {
    const k = this.kingdoms[id];
    if (!k) return HERALDRY.slice(0, 12).map((h) => h.color);
    const cap = this.villages[k.capital];
    const others = this.kingdoms.filter((o) => o.alive && o.villages.length && o.id !== id);
    const scored = HERALDRY.map((h) => {
      let s = 1;
      for (const o of others) {
        const ov = this.villages[o.capital];
        const near = (this.relations.get(relKey(o.id, id))?.border || 0) > 0 || (cap && ov && Math.hypot(cap.cx - ov.cx, cap.cz - ov.cz) < 90);
        s = Math.min(s, colorDist(o.color, h.color) + (near ? 0 : 0.12));
      }
      return { c: h.color, s };
    });
    scored.sort((a, b) => b.s - a.s);
    return scored.slice(0, 12).map((x) => x.c);
  },

  setKingdomBanner(id, banner) {
    const k = this._liveKingdom(id);
    if (!k || !banner || typeof banner !== 'object') return false;
    const cur = k.banner || this._defaultBanner(k);
    const symbol = banner.symbol ?? cur.symbol;
    let field = banner.field ?? cur.field;
    field = FIELD_ALIAS[field] || field;
    if (!BANNER_SYMBOLS.includes(symbol) || !BANNER_FIELDS.includes(field)) return false;
    k.banner = { symbol, field };
    this._mark(k, 'banner');
    return this._edited('kingdom', id, 'banner', { ...k.banner });
  },

  // A new realm's banner: an emblem of its people, a field unlike its neighbours'.
  _defaultBanner(k, x = null, z = null) {
    const rng = this.rng;
    const pool = CULTURE_SYMBOLS[baseCulture(k.culture)] || BANNER_SYMBOLS;
    const used = new Set();
    for (const o of this.kingdoms) {
      if (!o.alive || o === k || !o.banner) continue;
      const ov = this.villages[o.capital];
      if (x == null || !ov || Math.hypot(ov.cx - x, ov.cz - z) < 110) used.add(o.banner.symbol + '|' + o.banner.field);
    }
    for (let t = 0; t < 24; t++) {
      const symbol = t < 12 ? pool[(rng.next() * pool.length) | 0] : BANNER_SYMBOLS[(rng.next() * BANNER_SYMBOLS.length) | 0];
      const field = BANNER_FIELDS[(rng.next() * BANNER_FIELDS.length) | 0];
      if (!used.has(symbol + '|' + field)) return { symbol, field };
    }
    return { symbol: pool[0], field: 'plain' };
  },

  setKingdomMotto(id, text) {
    const k = this._liveKingdom(id);
    if (!k) return false;
    if (text == null || text === '') {
      k.motto = '';
      return this._edited('kingdom', id, 'motto', '');
    }
    const t = cleanName(text, 48);
    if (!t) return false;
    k.motto = t;
    this._mark(k, 'motto');
    return this._edited('kingdom', id, 'motto', t);
  },

  // Divine diplomacy: war, peace or alliance at once.
  setRelation(aId, bId, mode) {
    const A = this._liveKingdom(aId),
      B = this._liveKingdom(bId);
    if (!A || !B || A === B || !['war', 'peace', 'alliance'].includes(mode)) return false;
    const r = this.rel(aId, bId);
    const now = this.game.time.total;
    if (mode === 'war') {
      if (!r.war) {
        r.ally = false;
        r.truceUntil = 0;
        if (!this.declareWar(aId, bId, 'god', true)) {
          // even the world laws bow to a god's decree
          r.war = true;
          r.warSince = now;
          r.reason = 'god';
          r.attacker = aId;
          r.losses = [0, 0];
          r.startPop = [A.population || 1, B.population || 1];
          r.lossBase = { [A.id]: A.warLosses, [B.id]: B.warLosses };
          r.sieged = false;
          r.conquests = 0;
        }
      }
      this._note(`⚡ By divine decree, ${this._kn(A)} and ${this._kn(B)} go to war`, 'war', this._kingdomPos(B));
    } else {
      if (r.war) this.makePeace(aId, bId, true);
      r.truceUntil = now + YEAR * 8;
      if (mode === 'alliance') {
        r.ally = true;
        r.opinion = Math.max(r.opinion, 40);
        this._note(`⚡ By divine decree, ${this._kn(A)} and ${this._kn(B)} are bound in alliance`, 'good', this._kingdomPos(A));
      } else {
        r.ally = false;
        r.opinion = Math.max(r.opinion, 0);
        this._note(`⚡ By divine decree, peace between ${this._kn(A)} and ${this._kn(B)}`, 'good', this._kingdomPos(A));
      }
    }
    r.player = mode;
    r.playerT = now;
    return this._edited('kingdom', aId, 'relation', { other: bId, mode });
  },

  // The AI may not touch a relation the player set while either realm locks diplomacy.
  _relLocked(r) {
    if (!r || !r.player) return false;
    return !!(this.kingdoms[r.a]?.policy?.lockDiplomacy || this.kingdoms[r.b]?.policy?.lockDiplomacy);
  },

  setKingdomPolicy(id, key, value) {
    const k = this._liveKingdom(id);
    const P = POLICY_KEYS[key];
    if (!k || !P) return false;
    const pol = k.policy || (k.policy = {});
    if (value == null) delete pol[key];
    else if (P.type === 'bool') {
      if (typeof value !== 'boolean') return false;
      pol[key] = value;
    } else {
      const n = Number(value);
      if (!Number.isFinite(n) || n < P.min || n > P.max) return false;
      pol[key] = n;
    }
    if (key === 'expansion' && pol.expansion === false) for (const e of [...this.expeditions]) if (this.villages[e.from]?.kingdom === id) this._abortExpedition?.(e);
    return this._edited('kingdom', id, 'policy:' + key, pol[key] ?? null);
  },

  kingdomPolicies(id) {
    const k = this.kingdoms[id];
    if (!k) return null;
    const out = {};
    for (const [key, P] of Object.entries(POLICY_KEYS)) out[key] = k.policy?.[key] ?? (P.law ? this.law(P.law, P.def ?? true) : P.def);
    return out;
  },

  // A world law as it applies to one realm (its policy overrides the law).
  _kLaw(kid, lawKey, def = true) {
    const pol = this.kingdoms[kid]?.policy;
    if (pol) for (const [key, P] of Object.entries(POLICY_KEYS)) if (P.law === lawKey && pol[key] != null) return pol[key];
    return this.law(lawKey, def);
  },

  renameCulture(cultureId, name) {
    const c = this.cultureDef?.(cultureId);
    const n = cleanName(name, 32);
    if (!c || !n || c.id !== cultureId) return false;
    if (this.cultures.some((o) => o !== c && o.name === n)) return false;
    const old = c.name;
    c.name = n;
    c.player = { ...(c.player || {}), name: true };
    this._history(`The ${old} shall now be known as the ${n}.`, 'info', null);
    return this._edited('culture', cultureId, 'name', n);
  },

  // ------------------------------------------------------------ villages
  renameVillage(id, name) {
    const v = this.villages[id];
    const n = cleanName(name, 32);
    if (!v || !v.alive || !n) return false;
    if (n === v.name) return true;
    const old = v.name;
    v.name = n;
    this.usedNames?.add?.(n);
    this._mark(v, 'name');
    // a realm named after its seat follows it
    const k = this.kingdoms[v.kingdom];
    if (k && k.capital === v.id && !k.player?.name && k.base === old) {
      k.base = n;
      if (k.name.includes(old)) k.name = k.name.replace(old, n);
    }
    this._history(`${old} shall now be known as ${n}.`, 'info', { x: v.cx, z: v.cz });
    return this._edited('village', id, 'name', n);
  },

  // Public: by id, to a kingdom or (null) to a new free realm. The simulation
  // itself calls the same name with a village object (conquest, rebellion).
  transferVillage(v, kid, cause = 'conquest') {
    if (v && typeof v === 'object') return this._transferVillage(v, kid, cause);
    const vil = this.villages[v];
    if (!vil || !vil.alive) return false;
    const old = this.kingdoms[vil.kingdom];
    if (kid == null) {
      if (old && old.villages.length === 1) return false; // already a realm of its own
      const K = this.createKingdom(vil.culture, { baseName: vil.name, parent: old ? old.id : -1, x: vil.cx, z: vil.cz });
      this._transferVillage(vil, K.id, 'gift');
      K.capital = vil.id;
      let leader = null;
      for (const u of vil.members) if (u.alive && u.age >= ADULT_AGE + 2 && (!leader || u.age > leader.age)) leader = u;
      if (leader) this.crown(K, leader);
      this._note(`⚡ By divine will, ${vil.name} is freed from ${this._kn(old)}: the ${K.name}`, 'info', { x: vil.cx, z: vil.cz });
    } else {
      const K = this._liveKingdom(kid);
      if (!K || K.id === vil.kingdom) return false;
      this._transferVillage(vil, K.id, 'gift');
      this._note(`⚡ By divine will, ${vil.name} passes from ${this._kn(old)} to ${this._kn(K)}`, 'info', { x: vil.cx, z: vil.cz });
    }
    this._territory?.();
    return this._edited('village', vil.id, 'kingdom', vil.kingdom);
  },

  setVillagePolicy(id, key, value) {
    const v = this.villages[id];
    if (!v || !v.alive || !VPOLICY_KEYS[key]) return false;
    const pol = v.policy || (v.policy = {});
    if (key === 'capital') {
      if (value !== true) return false;
      const k = this.kingdoms[v.kingdom];
      if (!k) return false;
      if (k.capital !== v.id) {
        k.capital = v.id;
        this._note(`👑 ${v.name} becomes the seat of ${this._kn(k)}`, 'info', { x: v.cx, z: v.cz });
      }
      return this._edited('village', id, 'capital', true);
    }
    if (value == null) delete pol[key];
    else if (VPOLICY_KEYS[key] === 'bool') {
      if (typeof value !== 'boolean') return false;
      pol[key] = value;
      if (key === 'walls' && value === false) {
        v.wallPlan = [];
        for (const b of [...v.buildings]) if (b.alive && b.constructing && BUILDING_TYPES[b.type]?.wall) {
          v.stone += 3;
          this.destroyBuilding(b, 'cancelled');
        }
      }
      if (key === 'walls' && value === true && !v.wallPlan?.length) v.wallsPlanned = false;
    } else {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0.25 || n > 3) return false;
      pol[key] = n;
    }
    return this._edited('village', id, 'policy:' + key, pol[key] ?? null);
  },

  villagePolicies(id) {
    const v = this.villages[id];
    if (!v) return null;
    const k = this.kingdoms[v.kingdom];
    return {
      walls: v.policy?.walls ?? !!this.law('civWalls'),
      growth: v.policy?.growth ?? 1,
      buildings: v.policy?.buildings ?? true,
      capital: !!k && k.capital === v.id,
    };
  },
};

