import { CULTURES, baseCulture } from './cultures.js';
import { YEAR, clamp } from './util.js';

// Living cultures. The four founding peoples keep their base ids ('vale',
// 'dune', 'frost', 'mire'); peoples that drift away get ids like 'vale~2'
// and a name of their own, but keep their ancestors' language and building
// style. Culture traits shape what villages build, which jobs they favour,
// how warlike they are and what they research.
//
// API (on game.civ): cultures (array), cultureDef(id), cultureName(id),
//   hasCultureTrait(id, trait); village.cultureMix {cultureId: share}.

export const CULTURE_TRAITS = ['Seafaring', 'Martial', 'Scholarly', 'Pastoral', 'Mystic', 'Mercantile', 'Masons', 'Wanderers'];

export const TRAIT_INFO = {
  Seafaring: 'Builds harbours early and loves the sea.',
  Martial: 'Keeps more soldiers and is quick to fight.',
  Scholarly: 'Researches faster and builds libraries.',
  Pastoral: 'Tends more fields; richer harvests.',
  Mystic: 'Raises temples early; loyal villages.',
  Mercantile: 'Markets and coin; richer trade.',
  Masons: 'Builds faster; loves walls and stone.',
  Wanderers: 'Sends settlers far and often.',
};

const BASE_TRAITS = {
  vale: ['Pastoral', 'Masons'],
  dune: ['Mercantile', 'Seafaring'],
  frost: ['Martial', 'Seafaring'],
  mire: ['Mystic', 'Wanderers'],
};
const BASE_COLOR = { vale: 0x7fae5a, dune: 0xd9a25a, frost: 0x8aa6c8, mire: 0x9a7cc0 };
const SUFFIX = {
  vale: ['ish', 'folk', 'en', 'ings'],
  dune: ['i', 'ani', 'ari', 'eni'],
  frost: ['ings', 'folk', 'ar', 'ung'],
  mire: ['ki', 'ani', 'u', 'oa'],
};

export const culture = {
  _initCultures() {
    this.cultures = [];
    this._cultureById = new Map();
    this._cultureSeq = 1;
    for (const id of Object.keys(CULTURES)) {
      const c = { id, name: CULTURES[id].name, base: id, traits: BASE_TRAITS[id].slice(), color: BASE_COLOR[id], language: id, founded: 0, parent: null };
      this.cultures.push(c);
      this._cultureById.set(id, c);
    }
  },

  cultureDef(id) {
    return this._cultureById?.get(id) || this._cultureById?.get(baseCulture(id)) || null;
  },
  cultureName(id) {
    return this.cultureDef(id)?.name || CULTURES[baseCulture(id)]?.name || 'Unknown';
  },
  hasCultureTrait(id, trait) {
    return !!this.cultureDef(id)?.traits.includes(trait);
  },

  _mixAdd(v, id, w) {
    if (!v.cultureMix) v.cultureMix = { [v.culture]: 1 };
    v.cultureMix[id] = (v.cultureMix[id] || 0) + w;
    let sum = 0;
    for (const k in v.cultureMix) sum += v.cultureMix[k];
    for (const k in v.cultureMix) {
      v.cultureMix[k] /= sum;
      if (v.cultureMix[k] < 0.02) delete v.cultureMix[k];
    }
  },

  // A people's name: the town's own first syllable (whole) plus an ending of
  // the language; other endings, then other syllables, if the name is taken.
  _peopleName(base, townName, sufBase = base) {
    const rng = this.rng;
    const syl = CULTURES[base].syl.place[0] || ['Al'];
    const own = syl.filter((p) => townName.startsWith(p)).sort((a, b) => b.length - a.length)[0];
    const pres = [own, ...syl.slice().sort(() => rng.next() - 0.5)].filter(Boolean);
    const sufs = SUFFIX[sufBase].slice().sort(() => rng.next() - 0.5);
    for (const pre of pres.slice(0, 8))
      for (let suf of sufs) {
        const last = pre[pre.length - 1].toLowerCase();
        if ('aeiou'.includes(last) && 'aeiou'.includes(suf[0])) suf = suf.slice(1);
        const name = pre + suf;
        if (!this.cultures.some((c) => c.name === name)) return name;
      }
    return null;
  },

  // A new people emerges in a distant colony.
  _newCulture(v) {
    const parent = this.cultureDef(v.culture);
    const base = parent?.base || baseCulture(v.culture);
    const rng = this.rng;
    const name = this._peopleName(base, v.name);
    if (!name) return null;
    const traits = (parent?.traits || BASE_TRAITS[base]).slice();
    const pool = CULTURE_TRAITS.filter((t) => !traits.includes(t));
    // drift: swap one trait, sometimes gain a third
    if (traits.length && rng.chance(0.7)) traits[(rng.next() * traits.length) | 0] = pool.splice((rng.next() * pool.length) | 0, 1)[0];
    if (traits.length < 3 && rng.chance(0.45)) traits.push(pool[(rng.next() * pool.length) | 0]);
    const id = `${base}~${this._cultureSeq++}`;
    const hue = ((BASE_COLOR[base] >> 16) & 255) ^ ((rng.next() * 255) | 0);
    const c = { id, name, base, traits: [...new Set(traits.filter(Boolean))], color: (hue << 16) | (BASE_COLOR[base] & 0xffff), language: base, founded: this.game.time.total, parent: parent?.id ?? base };
    this.cultures.push(c);
    this._cultureById.set(id, c);
    return c;
  },

  // Every 5 s: mixes drift toward the majority, assimilation, new peoples.
  _cultureTick() {
    const now = this.game.time.total;
    this._nCult = this.livingCultures().length;
    for (const v of this.villages) {
      if (!v.alive) continue;
      if (!v.cultureMix) v.cultureMix = { [v.culture]: 1 };
      // the majority slowly absorbs minorities
      let dom = v.culture,
        dv = 0;
      for (const id in v.cultureMix)
        if (v.cultureMix[id] > dv) {
          dv = v.cultureMix[id];
          dom = id;
        }
      this._mixAdd(v, dom, 0.015);
      if (dom !== v.culture && dv > 0.62) {
        const was = this.cultureName(v.culture);
        v.culture = dom;
        this._history(`${v.name} now speaks the tongue of the ${this.cultureName(dom)} (once ${was})`, 'info', { x: v.cx, z: v.cz });
      }
      // a distant, long-settled colony grows into a people of its own
      const k = this.kingdoms[v.kingdom];
      const cap = k && this.villages[k.capital];
      const origin = this._cultureOrigin(v.culture);
      const far = origin ? Math.hypot(origin.x - v.cx, origin.z - v.cz) : 0;
      // (slowly: peoples are born over generations, and the world holds at most 16)
      if (far > 40 && v.pop >= 10 && now - v.founded > YEAR * 25 && this.rng.chance(0.0035) && (this._nCult ?? 0) < 16) {
        const c = this._newCulture(v);
        if (!c) continue;
        c.origin = { x: v.cx, z: v.cz };
        v.culture = c.id;
        v.cultureMix = { [c.id]: 0.7, ...Object.fromEntries(Object.entries(v.cultureMix).map(([a, b]) => [a, b * 0.3])) };
        this._note(`🌱 A new people, the ${c.name}, emerges at ${v.name}`, 'good', { x: v.cx, z: v.cz }, 'culture' + c.id, 1);
      }
      void cap;
      // two peoples long living side by side blend into a new one
      let a = null,
        b = null;
      for (const id in v.cultureMix) {
        const s = v.cultureMix[id];
        if (!a || s > v.cultureMix[a]) (b = a), (a = id);
        else if (!b || s > v.cultureMix[b]) b = id;
      }
      if (a && b && v.cultureMix[b] >= 0.28 && v.pop >= 12) {
        v.syncT = (v.syncT || 0) + 5;
        if (v.syncT > YEAR * 12 && this.rng.chance(0.03)) {
          const c = this._blendCulture(v, a, b);
          if (c) {
            v.syncT = 0;
            v.culture = c.id;
            v.cultureMix = { [c.id]: 0.8, [a]: 0.1, [b]: 0.1 };
            this._note(`🌿 In ${v.name} the ${this.cultureName(a)} and the ${this.cultureName(b)} become one people: the ${c.name}`, 'good', { x: v.cx, z: v.cz }, 'blend' + c.id, 1);
          }
        }
      } else v.syncT = Math.max(0, (v.syncT || 0) - 5);
    }
    this._cultureDrift(now);
    // a kingdom's culture is its capital's
    for (const k of this.kingdoms) {
      if (!k.alive) continue;
      const cap = this.villages[k.capital];
      if (cap && cap.alive && cap.culture !== k.culture) {
        k.culture = cap.culture;
        this.colorVersion++;
      }
    }
    // cultures with no village left fade from the world
    const living = new Set(this.villages.filter((v) => v.alive).flatMap((v) => Object.keys(v.cultureMix || { [v.culture]: 1 })));
    for (const c of this.cultures) c.alive = living.has(c.id) || c.base === c.id;
  },

  // A blended people: the language and buildings of the majority, a trait of each.
  _blendCulture(v, a, b) {
    const A = this.cultureDef(a),
      B = this.cultureDef(b);
    if (!A || !B || (this._nCult ?? 0) >= 16) return null;
    const base = A.base;
    const name = this._peopleName(base, v.name, B.base);
    if (!name) return null;
    const rng = this.rng;
    const ta = A.traits[(rng.next() * A.traits.length) | 0],
      tb = B.traits.filter((t) => t !== ta)[(rng.next() * B.traits.length) | 0] || B.traits[0];
    const traits = [...new Set([ta, tb].filter(Boolean))];
    const id = `${base}~${this._cultureSeq++}`;
    const c = { id, name, base, traits, color: ((A.color >> 1) & 0x7f7f7f) + ((B.color >> 1) & 0x7f7f7f), language: base, founded: this.game.time.total, parent: A.id, blend: [A.id, B.id], origin: { x: v.cx, z: v.cz } };
    this.cultures.push(c);
    this._cultureById.set(id, c);
    return c;
  },

  // Over the centuries peoples change: a trait gives way to what their history
  // has taught them, and a realm long apart from its kin becomes its own people.
  _cultureDrift(now) {
    const rng = this.rng;
    for (const c of this.cultures) {
      if (c.alive === false || now - (c.drifted ?? c.founded ?? 0) < YEAR * 45) continue;
      if (!rng.chance(0.006)) continue;
      // what the people's villages have lived through
      let war = 0,
        sea = 0,
        temples = 0,
        books = 0,
        n = 0;
      for (const v of this.villages) {
        if (!v.alive || v.culture !== c.id) continue;
        n++;
        if (this.warCount(v.kingdom) > 0) war++;
        if (v.coastal) sea++;
        for (const b of v.buildings) {
          if (!b.alive) continue;
          if (b.type === 'temple') temples++;
          else if (b.type === 'library' || b.type === 'observatory') books++;
        }
      }
      if (!n) continue;
      const w = { Martial: 1 + (war / n) * 4, Seafaring: 0.5 + (sea / n) * 3, Mystic: 1 + (temples / n) * 2, Scholarly: 1 + (books / n) * 3, Pastoral: 1.2, Mercantile: 1, Masons: 1, Wanderers: 0.8 };
      const pool = CULTURE_TRAITS.filter((t) => !c.traits.includes(t));
      let tot = 0;
      for (const t of pool) tot += w[t] || 1;
      let r = rng.next() * tot,
        pick = pool[0];
      for (const t of pool) {
        r -= w[t] || 1;
        if (r <= 0) {
          pick = t;
          break;
        }
      }
      const i = (rng.next() * c.traits.length) | 0;
      const old = c.traits[i];
      c.traits[i] = pick;
      c.drifted = now;
      const pos = this._cultureOrigin(c.id);
      this._note(`📜 The ${c.name} grow ${pick.toLowerCase()} (once ${old.toLowerCase()})`, 'info', pos, 'drift' + c.id, 1);
    }
    // a realm far from its people's homeland, settled for generations, splits off
    for (const k of this.kingdoms) {
      if (!k.alive || !k.villages.length || now - k.founded < YEAR * 40 || now - (k.splitT ?? -1e9) < YEAR * 60) continue;
      if (!rng.chance(0.004)) continue;
      const cap = this.villages[k.capital];
      if (!cap?.alive || cap.pop < 14 || (this._nCult ?? 0) >= 16) continue;
      const shared = this.kingdoms.some((o) => o !== k && o.alive && o.villages.length && o.culture === k.culture);
      const origin = this._cultureOrigin(k.culture);
      const far = origin ? Math.hypot(origin.x - cap.cx, origin.z - cap.cz) : 0;
      if (!shared && far < 60) continue;
      const old = k.culture;
      const c = this._newCulture(cap);
      if (!c) continue;
      c.origin = { x: cap.cx, z: cap.cz };
      k.splitT = now;
      for (const vid of k.villages) {
        const v = this.villages[vid];
        if (!v?.alive || v.culture !== old) continue;
        v.culture = c.id;
        v.cultureMix = { [c.id]: 0.75, [old]: 0.25 };
      }
      k.culture = c.id;
      this.colorVersion++;
      this._note(`🌱 Long apart from their kin, the people of ${this._kn(k)} become the ${c.name}`, 'good', { x: cap.cx, z: cap.cz }, 'split' + c.id, 1);
    }
  },

  _cultureOrigin(id) {
    const c = this.cultureDef(id);
    if (c?.origin) return c.origin;
    // founding peoples: the oldest capital that shares the culture
    for (const k of this.kingdoms) {
      if (k.culture !== id || !k.alive) continue;
      const v = this.villages[k.capital];
      if (v) return (c.origin = { x: v.cx, z: v.cz });
    }
    return null;
  },

  livingCultures() {
    return this.cultures.filter((c) => c.alive !== false && this.villages.some((v) => v.alive && v.cultureMix && v.cultureMix[c.id]));
  },
};

export { clamp as _clamp };
