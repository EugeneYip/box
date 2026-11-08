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

  // A new people emerges in a distant colony.
  _newCulture(v) {
    const parent = this.cultureDef(v.culture);
    const base = parent?.base || baseCulture(v.culture);
    const rng = this.rng;
    const root = v.name.replace(/[^A-Za-z]/g, '').slice(0, Math.max(3, Math.min(6, v.name.length - 2)));
    const name = root.charAt(0).toUpperCase() + root.slice(1).toLowerCase() + SUFFIX[base][(rng.next() * SUFFIX[base].length) | 0];
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
      if (far > 40 && v.pop >= 10 && now - v.founded > YEAR * 10 && this.rng.chance(0.02)) {
        const c = this._newCulture(v);
        c.origin = { x: v.cx, z: v.cz };
        v.culture = c.id;
        v.cultureMix = { [c.id]: 0.7, ...Object.fromEntries(Object.entries(v.cultureMix).map(([a, b]) => [a, b * 0.3])) };
        this._note(`🌱 A new people, the ${c.name}, emerges at ${v.name}`, 'good', { x: v.cx, z: v.cz }, 'culture' + c.id, 1);
      }
      void cap;
    }
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
