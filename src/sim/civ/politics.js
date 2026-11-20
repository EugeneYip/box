import { CULTURES, HERALDRY, HERALDRY_AVOID, colorDist, baseCulture, placeName, kingdomName as makeKingdomName, rulerTitle } from './cultures.js';
import { BUILDING_TYPES, buildingLabel } from './catalog.js';
import { YEAR, ADULT_AGE, clamp } from './util.js';
import { geoRegion, geoDist } from '../../world/geo.js';

// Kingdoms, rulers, diplomacy (opinion, alliances, war), armies, conquest,
// rebellion and collapse. Mixed into Civilization.prototype.

const relKey = (a, b) => (a < b ? a * 4096 + b : b * 4096 + a);
// A newborn crown's years safe from reconquest, and the people (or towns) a
// rising needs to crown a realm of its own: a lone town of a dozen families
// goes over to a neighbour or wins concessions and stays.
const REALM_GRACE = 15;
const REALM_MIN_POP = 30;

export const politics = {
  // ---------------------------------------------------------------- kingdoms
  _uniqueRealmName(name, culture, base, real) {
    const taken = new Set();
    for (const o of this.kingdoms) if (o?.alive && o.name) taken.add(o.name);
    if (!taken.has(name)) return name;
    const forms = real ? [] : CULTURES[baseCulture(culture)]?.forms || [];
    for (const f of forms) {
      const n = f.replace('{n}', base);
      if (!taken.has(n)) return n;
    }
    for (const q of ['New', 'Upper', 'Lower', 'Greater', 'Outer']) {
      const n = name.includes(base) ? name.replace(base, q + ' ' + base) : q + ' ' + name;
      if (!taken.has(n)) return n;
    }
    let i = 2;
    while (taken.has(name + ' ' + i)) i++;
    return name + ' ' + i;
  },
  createKingdom(culture, opts = {}) {
    const rng = this.rng;
    const id = this.kingdoms.length;
    const base = opts.baseName || placeName(culture, rng, this.usedNames);
    // World Map: a realm that rises later takes a plain real name (its fallen
    // country's, its land's, or its seat's), never "Duchy of Kumamoto"
    const real = !opts.name && this._realMapOn?.() ? this._newRealmName(base, opts) : null;
    let her = this._pickTincture(culture, opts.x, opts.z, -1);
    if (opts.color != null) her = HERALDRY.find((h) => h.color === opts.color) || her;
    else if (real?.color != null && this._tinctureFree(real.color, opts.x, opts.z)) her = HERALDRY.find((h) => h.color === real.color) || her;
    if (!her) her = HERALDRY[id % HERALDRY.length];
    let name = opts.name || real?.name || makeKingdomName(culture, base, rng);
    // no two living realms share a name (two "Kingdom of Dunwick"s rose
    // from towns of one name): another form of the culture's, else "New ..."
    if (!opts.name) name = this._uniqueRealmName(name, culture, real ? real.name : base, !!real);
    const k = {
      id,
      name,
      base: real ? real.name : base,
      color: her.color,
      colorName: her.name,
      culture,
      capital: -1,
      ruler: -1,
      rulerName: '',
      alive: true,
      founded: this.game.time.total,
      villages: [],
      population: 0,
      soldiers: 0,
      strength: 0,
      aggression: rng.float(0.15, 0.85),
      ambition: rng.float(0.1, 0.9),
      goldenUntil: 0,
      interregnumUntil: 0,
      warLosses: 0,
      kills: 0,
      parent: opts.parent ?? -1,
      lastWar: -999,
    };
    if (real) {
      k.plain = true;
      if (real.realm >= 0) k.realm = real.realm;
      if (real.placesFrom >= 0) k.placesFrom = real.placesFrom;
    }
    this._initTech(k);
    k.banner = real?.banner && real.color === k.color ? { ...real.banner } : this._defaultBanner ? this._defaultBanner(k, opts.x, opts.z) : null;
    k.inventory = { food: 0, wood: 0, stone: 0, ore: 0, gold: 0, tools: 0, weapons: 0, armor: 0 };
    // a breakaway realm, or settlers striking out on their own, inherit what
    // their parent knew (a two-family duchy of Year 300 no longer starts in
    // the Hearth age with Pottery alone); wanderers bring the arts that every
    // living realm already shares
    const par = this.kingdoms[opts.parent];
    if (par?.techs) {
      for (const t of par.techs) k.techs.add(t);
      k.era = par.era || 0;
    } else if (opts.wanderers) this._commonTechs?.(k);
    this.kingdoms.push(k);
    this.colorVersion++;
    return k;
  },

  // The tincture that stands out most from the living realms: neighbours (by
  // border or by distance) must differ most, far realms may share a colour.
  _pickTincture(culture, x, z, selfId = -1) {
    const avoid = new Set(HERALDRY_AVOID[baseCulture(culture)] || []);
    const others = this.kingdoms.filter((k) => k.alive && k.villages.length && k.id !== selfId);
    const nearW = (k) => {
      if (selfId >= 0 && (this.relations.get(relKey(k.id, selfId))?.border || 0) > 0) return 0;
      if (x == null) return 0.12;
      const v = this.villages[k.capital];
      if (!v) return 0.3;
      const d = geoDist(this.world, v.cx, v.cz, x, z);
      return d < 70 ? 0 : d < 130 ? 0.08 : 0.25; // a far realm may repeat a tincture
    };
    let her = null,
      bs = -Infinity;
    const taken = new Set(others.map((k) => k.color));
    const anyFree = HERALDRY.some((h) => !avoid.has(h.name) && !taken.has(h.color));
    for (const h of HERALDRY) {
      if (avoid.has(h.name)) continue;
      if (anyFree && taken.has(h.color)) continue; // a free tincture always comes first
      let score = 1;
      for (const k of others) score = Math.min(score, colorDist(k.color, h.color) + nearW(k));
      score += this.rng.next() * 0.01;
      if (score > bs) {
        bs = score;
        her = h;
      }
    }
    return her;
  },

  // A tincture no realm near (x, z) wears or nearly wears (a country that
  // rises again keeps its old colours when they are free).
  _tinctureFree(color, x, z) {
    for (const k of this.kingdoms) {
      if (!k.alive || !k.villages.length) continue;
      const v = this.villages[k.capital];
      if (x != null && v && geoDist(this.world, v.cx, v.cz, x, z) > 130) continue;
      if (colorDist(k.color, color) < 0.15) return false;
    }
    return true;
  },

  // Neighbours whose colours read as one (after a conquest or a rising moved
  // the borders) re-dye the younger realm's banners.
  _recolorClashes() {
    const now = this.game.time.total;
    const alive = this.kingdoms.filter((k) => k.alive && k.villages.length);
    for (let i = 0; i < alive.length; i++)
      for (let j = i + 1; j < alive.length; j++) {
        const A = alive[i],
          B = alive[j];
        const same = A.color === B.color;
        if (!same && colorDist(A.color, B.color) > 0.15) continue;
        const r = this.relations.get(relKey(A.id, B.id));
        const vA = this.villages[A.capital],
          vB = this.villages[B.capital];
        const close = (r?.border || 0) > 0 || r?.war || (vA && vB && geoDist(this.world, vA.cx, vA.cz, vB.cx, vB.cz) < 90);
        if (!close && !same) continue;
        let Y = A.founded > B.founded ? A : B;
        if (Y.player?.color) Y = Y === A ? B : A;
        if (Y.player?.color) continue;
        if (now - (Y.recolored ?? -1e9) < YEAR * (same ? 2 : 15)) continue;
        const cap = this.villages[Y.capital];
        const h = this._pickTincture(Y.culture, cap?.cx, cap?.cz, Y.id);
        if (!h || h.color === Y.color) continue;
        Y.color = h.color;
        Y.colorName = h.name;
        Y.recolored = now;
        this.colorVersion++;
        this.version++;
      }
  },

  rel(a, b) {
    const key = relKey(a, b);
    let r = this.relations.get(key);
    if (!r) {
      r = { a: Math.min(a, b), b: Math.max(a, b), opinion: 0, war: false, ally: false, warSince: 0, truceUntil: 0, grievance: 0, border: 0, contact: false, reason: '', losses: [0, 0], startPop: [0, 0], lastAction: 0 };
      this.relations.set(key, r);
    }
    return r;
  },
  atWar(a, b) {
    if (a < 0 || b < 0 || a === b) return false;
    const r = this.relations.get(relKey(a, b));
    return !!(r && r.war);
  },
  allied(a, b) {
    if (a < 0 || b < 0 || a === b) return false;
    const r = this.relations.get(relKey(a, b));
    return !!(r && r.ally);
  },
  enemiesOf(k) {
    const out = [];
    for (const r of this.relations.values()) if (r.war && (r.a === k || r.b === k)) out.push(r.a === k ? r.b : r.a);
    return out;
  },
  warCount(k) {
    return this.enemiesOf(k).length;
  },

  rulerLabel(k) {
    if (!k) return '';
    const u = this.game.units.byId.get(k.ruler);
    if (!u || !u.alive) return k.rulerName || 'No ruler';
    return u.name || k.rulerName;
  },

  // A former ruler goes back to the given name and loses the royal standing.
  _uncrown(u) {
    const d = u?.data?.civ;
    if (!d) return;
    // (only "<Title> <name>" is undone: a name the player gave is kept)
    if (d.given && u.name !== d.given && u.name?.endsWith(' ' + d.given)) u.name = d.given;
    d.given = undefined;
    d.royal = false;
    if (u.job === 'king') u.job = null;
  },

  // The title a realm's ruler bears: on a World Map world the realm's own
  // or a neutral one (realms.js _realTitle), elsewhere the culture's.
  _rulerTitle(k, sex) {
    const t = this._realTitle?.(k);
    return t ? t[sex === 'f' ? 'f' : 'm'] : rulerTitle(k.culture, sex);
  },

  crown(k, u) {
    if (!u) return;
    const title = this._rulerTitle(k, u.sex);
    const base = u.data.civ?.given || u.name || 'Nameless';
    u.data.civ = u.data.civ || {};
    u.data.civ.given = base;
    u.name = `${title} ${base}`;
    u.job = 'king';
    u.data.civ.task = null;
    u.maxHp = Math.max(u.maxHp, 150);
    u.hp = Math.max(u.hp, 150);
    u.data.civ.royal = true;
    u.data.civ.crownedAt = this.game.time.total;
    k.ruler = u.id;
    k.rulerName = u.name;
    k.council = false;
    this._bio(u, `Crowned ${title} of ${this._theK(k)}`);
    // name an heir straight away so the realm never drifts without one
    let heir = null;
    const v = this.villages[u.village];
    if (v) for (const m of v.members) if (m !== u && m.alive && m.age >= ADULT_AGE && (!heir || Math.abs(m.age - 24) < Math.abs(heir.age - 24))) heir = m;
    k.heir = heir ? heir.id : -1;
  },

  _succession(k, deadName, abdicated = false) {
    const cap = this.villages[k.capital];
    let heir = null;
    const pools = [];
    if (cap && cap.alive) pools.push(cap);
    for (const vid of k.villages) if (vid !== k.capital) pools.push(this.villages[vid]);
    for (const v of pools) {
      if (!v || !v.alive) continue;
      for (const u of v.members) {
        if (!u.alive || u.age < ADULT_AGE || u.data?.civ?.abdicated) continue;
        // a mature heir in the prime of life (closest to 30) rules longest
        if (!heir || Math.abs(u.age - 30) < Math.abs(heir.age - 30)) heir = u;
      }
      if (heir) break;
    }
    // the designated heir, if alive
    const named = this.game.units.byId.get(k.heir);
    if (named && named.alive && named.kingdom === k.id && named !== this.game.units.byId.get(k.ruler)) heir = named;
    if (!heir) {
      // no adult left: the eldest child rules under a regency
      for (const v of pools) {
        if (!v || !v.alive) continue;
        for (const u of v.members) if (u.alive && (!heir || u.age > heir.age)) heir = u;
      }
    }
    // the family and the court mourn (the spouse is Life's to grieve), not the realm
    const deadId = this._lastRulerId;
    if (cap && this.game.units.addStatus && !abdicated) {
      const hall = cap.hall;
      for (const m of cap.members) {
        if (!m.alive) continue;
        const c = m.data?.civ;
        const kin = deadId != null && c && (c.mother === deadId || c.father === deadId);
        const court = m.id === k.heir || (hall && m.job === 'soldier' && Math.hypot(m.x - hall.x, m.z - hall.z) < 6);
        if (kin || court) this.game.units.addStatus(m, 'mourning', kin ? 14 : 8);
      }
    }
    if (heir) {
      if (heir.village !== k.capital && cap && cap.alive) this._moveMember(heir, cap);
      this.crown(k, heir);
      this._note(abdicated ? `${deadName} abdicates; ${heir.name} rules ${this._kn(k)}` : `${deadName} dies; ${heir.name} rules ${this._kn(k)}`, 'info', { x: heir.x, z: heir.z }, 'succ' + k.id, 20);
      // a contested succession can split a large realm
      // (a real country's crown passes more surely: the seeded ones at
      // seven tenths split their land into a crown per province)
      const realK = k.realm >= 0 && this._realMapOn?.();
      if (k.villages.length >= 3 && this._kLaw(k.id, 'civRebellions') && !abdicated && this.rng.chance(Math.min(0.35, 0.1 + (k.villages.length - 3) * 0.03) * (realK ? 0.4 : k.seeded ? 0.7 : 1))) {
        let claimant = null;
        for (const vid of k.villages) {
          const v = this.villages[vid];
          if (!v?.alive || vid === k.capital || this._keyHeld?.(v)) continue;
          if (!claimant || v.pop - v.loyalty * 0.3 > claimant.pop - claimant.loyalty * 0.3) claimant = v;
        }
        if (claimant && claimant.pop >= 10) {
          this._note(`Succession contested: ${claimant.name} defies ${heir.name}`, 'war', { x: claimant.cx, z: claimant.cz });
          this._civilWar = k.villages.length >= 6; // a war of succession splits a great realm
          this._autoRise = true;
          const R = this.rebel(claimant, false, true);
          this._autoRise = false;
          this._civilWar = false;
          if (R) this.declareWar(R.id, k.id, 'rebellion', true);
        }
      }
    } else {
      k.ruler = -1;
      k.interregnumUntil = this.game.time.total + YEAR * 5;
      this._note(`${deadName} dies heirless; a council of elders rules ${this._kn(k)}`, 'bad', cap ? { x: cap.cx, z: cap.cz } : null);
      k.council = true;
    }
  },

  // A crown worn for sixty years is laid down (an immortal ruler, or one the
  // gods keep young, would otherwise reign for ever): the heir takes the throne
  // and the old ruler lives on at court.
  _abdications() {
    const now = this.game.time.total;
    for (const k of this.kingdoms) {
      if (!k.alive) continue;
      const u = this.game.units.byId.get(k.ruler);
      if (!u || !u.alive) continue;
      const since = u.data.civ?.crownedAt ?? now;
      if (now - since < YEAR * 60) continue;
      const name = u.name;
      u.data.civ.abdicated = true;
      u.data.civ.royal = false;
      u.job = null;
      const ttl = this._rulerTitle(k, u.sex);
      if (u.data.civ.given) u.name = u.data.civ.given;
      else if (u.name?.startsWith(ttl + ' ')) u.name = u.name.slice(ttl.length + 1);
      const yrs = Math.round((now - since) / YEAR);
      if (this.game.units.log) this.game.units.log(u, `Laid down the crown of ${this._kn(k)} after ${yrs} years`);
      else this._bio(u, `Laid down the crown after ${yrs} years`);
      this._note(`👑 ${name} lays down the crown of ${this._kn(k)} after ${yrs} years`, 'info', { x: u.x, z: u.z }, 'abdicate' + k.id, 1);
      k.ruler = -1;
      this._succession(k, name, true);
    }
  },

  // A realm of many towns in a full world is hard to hold: now and then its
  // farthest provinces break away together as a realm of their own.
  _overextension() {
    if (!this.law('civRebellions')) return;
    const now = this.game.time.total;
    const realMap = this._realMapOn?.();
    for (const k of this.kingdoms) {
      // (a real country on a World Map world holds more towns before it cracks)
      const big = realMap && k.realm >= 0 ? 12 : 8;
      if (!k.alive || k.villages.length < big) continue;
      const share = k.villages.length / Math.max(1, this.villages.filter((v) => v.alive).length);
      if (!this._kLaw(k.id, 'civRebellions') && share < 0.35) continue;
      if (now - (k.crackT ?? k.founded) < YEAR * 25) continue;
      if (!this.rng.chance(0.004 * (k.villages.length - big + 1) * (0.5 + (this._crowd?.() || 0)) * (1 + Math.max(0, now - k.founded) / (YEAR * 150)))) continue;
      const cap = this.villages[k.capital];
      if (!cap) continue;
      let far = null,
        fd = -1;
      for (const vid of k.villages) {
        const v = this.villages[vid];
        if (!v?.alive || vid === k.capital || v.pop < 8 || this._keyHeld?.(v)) continue;
        const d = geoDist(this.world, v.cx, v.cz, cap.cx, cap.cz) - v.loyalty * 0.3;
        if (d > fd) (fd = d), (far = v);
      }
      if (!far) continue;
      k.crackT = now;
      this._civilWar = true;
      this._autoRise = true;
      const R = this.rebel(far, true, true);
      this._autoRise = false;
      this._civilWar = false;
      if (R) this._note(`✊ Overstretched, ${this._kn(k)} cracks: ${far.name} leads its far provinces away as ${this._theK(R)}`, 'war', { x: far.cx, z: far.cz });
    }
  },

  // A one- or two-town realm long allied with a greater realm of its own
  // people joins it in union (fewer splinters on big maps). On a World Map
  // world the real country is the crown that stays (see _realUnion).
  _unions() {
    const now = this.game.time.total;
    if (now - (this._unionT || 0) < YEAR * 2) return;
    this._unionT = now;
    const realMap = this._realMapOn?.();
    // (a World Map world gathers its one-town crowns back twice as fast)
    let left = realMap ? 2 : 1;
    for (const r of this.relations.values()) {
      if (r.war || this._relLocked?.(r)) continue;
      const A = this.kingdoms[r.a],
        B = this.kingdoms[r.b];
      if (!A?.alive || !B?.alive || !A.villages.length || !B.villages.length) continue;
      let small, big;
      if (realMap) {
        const u = this._realUnion(A, B, r, now);
        if (!u) continue;
        [small, big] = u;
      } else {
        if (!r.ally || r.opinion < 30 || baseCulture(A.culture) !== baseCulture(B.culture)) continue;
        [small, big] = A.villages.length <= B.villages.length ? [A, B] : [B, A];
        if (small.villages.length > 2 || big.villages.length < small.villages.length + 1) continue;
        // a young crown keeps its freedom a while (unions were half of all
        // fallen realms, most of them at 25-30 years)
        if (now - small.founded < YEAR * 40) continue;
      }
      if (small.player?.name) continue;
      // a seat or must-exist city in the map's first 150 years changes hands
      // only by conquest
      if (small.villages.some((id) => this._keyCity?.(this.villages[id]))) continue;
      // a union is made over land: an island or a far continent keeps its own
      // crown (the World Map's Australia lost its last realms to unions abroad)
      if (this.villages[small.capital]?.landId !== this.villages[big.capital]?.landId) continue;
      if (!this.rng.chance(0.4)) continue;
      const name = this._kn(small);
      const home = small.parent === big.id || (big.realm >= 0 && small.placesFrom === big.realm);
      for (const vid of [...small.villages]) {
        const v = this.villages[vid];
        if (v?.alive) this._transferVillage(v, big.id, 'union');
      }
      this._note(`🤝 ${name} ${home ? 'rejoins' : 'joins'} ${this._kn(big)} in union`, 'good', this._kingdomPos(big), 'union' + small.id, 1);
      if (--left <= 0) return;
    }
  },

  // Unions on a World Map world, as [small, big] or null. A real country is
  // never folded into a generated realm: when the two unite, the real one
  // is the crown that stays, whatever their sizes. A country seeded at the
  // start keeps its own crown for seventy years (France, the Netherlands and
  // Poland had all been folded into neighbours by Year 55) and then joins
  // only a firm ally three times its size; any other real country keeps its
  // crown for thirty years. A breakaway long at peace with the country it
  // left, or with the real country whose land it stands in, goes back to it,
  // and a small realm long at peace beside a real country joins it: fewer
  // one-town crowns on the regional maps.
  _realUnion(A, B, r, now) {
    const ra = A.realm >= 0,
      rb = B.realm >= 0;
    let [small, big] = A.villages.length <= B.villages.length ? [A, B] : [B, A];
    if (ra !== rb) [small, big] = ra ? [B, A] : [A, B];
    const ns = small.villages.length,
      nb = big.villages.length;
    if (small.realm >= 0) {
      if (!(big.realm >= 0) || now - small.founded < YEAR * (small.seeded ? 70 : 30)) return null;
      if (small.seeded) return r.ally && r.opinion >= 40 && ns <= 1 && nb >= 3 ? [small, big] : null;
      return r.ally && r.opinion >= 30 && ns <= 2 && nb >= ns + 1 ? [small, big] : null;
    }
    if (now - small.founded < YEAR * 30) return null; // a young crown fights for its freedom first
    const regional = geoRegion(this.world) !== 'world';
    if (ns > (regional ? 3 : 2)) return null;
    if (big.realm >= 0 ? nb < ns - 1 : nb < ns + 1) return null;
    const peace = r.peaceT || 0;
    const kin = small.parent === big.id || (big.realm >= 0 && small.placesFrom === big.realm);
    if (r.ally && r.opinion >= (big.realm >= 0 ? 10 : 25)) return [small, big];
    if (kin && peace >= YEAR * (regional ? 6 : 8) && r.opinion >= -20) return [small, big];
    if (big.realm >= 0 && r.border > 0 && peace >= YEAR * (regional ? 10 : 12) && r.opinion >= 0) return [small, big];
    return null;
  },

  _chooseCapital(k) {
    // a real country keeps its seat in its own land while it holds any of it
    // (its real capital first), not in the biggest colony overseas
    const realCap = k.realm >= 0 ? this._realmData?.()?.[k.realm]?.capital?.name : null;
    const score = (v) => v.pop + (realCap && v.name === realCap ? 1e4 : 0) + (k.realm >= 0 && this._inOwnLand?.(k, v) ? 1e3 : 0);
    let best = null;
    for (const vid of k.villages) {
      const v = this.villages[vid];
      if (!v || !v.alive) continue;
      if (!best || score(v) > score(best)) best = v;
    }
    k.capital = best ? best.id : -1;
    return best;
  },

  _killKingdom(k, cause = 'fallen') {
    if (!k.alive) return;
    k.alive = false;
    this._noteCollapse?.((k.council ? 'heirless/' : '') + cause);
    // a fallen realm's relations go with it: every war query walks the whole
    // table, and by Year 600 the dead outnumbered the living seven to one
    for (const [key, r] of this.relations) {
      if (r.a === k.id || r.b === k.id) {
        r.war = false;
        r.ally = false;
        this.relations.delete(key);
      }
    }
    for (const a of this.armies) if (a.kingdom === k.id) this._disbandArmy(a);
    const cap = this.villages[k.capital];
    this._note(`${k.name} has fallen`, 'bad', cap ? { x: cap.cx, z: cap.cz } : null);
    this.colorVersion++;
  },

  // ---------------------------------------------------------------- diplomacy
  // A young crown (under REALM_GRACE years) whose towns have dwindled is
  // refilled: young families come from the nearest big town on its land of a
  // realm not at war with it (round 22: two realms fell within ten years of
  // their founding, their last town emptied).
  _keepYoungRealms() {
    const now = this.game.time.total;
    for (const k of this.kingdoms) {
      if (!k.alive || !k.villages.length || now - k.founded >= YEAR * REALM_GRACE || k.player?.name) continue;
      let pop = 0;
      for (const vid of k.villages) pop += this.villages[vid]?.pop || 0;
      const v = this.villages[k.capital];
      if (pop >= 10 || !v?.alive) continue;
      let src = null,
        sd = Infinity;
      for (const o of this.villages) {
        if (!o.alive || o.kingdom === k.id || o.landId !== v.landId || o.pop < 30 || o.starving || this.atWar(o.kingdom, k.id)) continue;
        const d = geoDist(this.world, o.cx, o.cz, v.cx, v.cz);
        if (d < sd) (sd = d), (src = o);
      }
      if (!src) continue;
      let moved = 0;
      for (const u of [...src.members]) {
        if (moved >= 3) break;
        if (!u.alive || u.age < ADULT_AGE || u.age > 40 || u.job === 'king' || u.job === 'soldier' || u.data?.civ?.army) continue;
        this._moveMember(u, v);
        moved++;
      }
      if (moved) this._history(`Families from ${src.name} settle in ${v.name}`, 'info', { x: v.cx, z: v.cz });
    }
  },

  _diplomacy() {
    this._keepYoungRealms();
    this._recolorClashes();
    this._abdications();
    this._overextension();
    this._unions();
    this._secession();
    this._keepKeyCities?.();
    const g = this.game;
    const rng = this.rng;
    const now = g.time.total;
    const alive = this.kingdoms.filter((k) => k.alive && k.villages.length);
    // kingdom aggregates
    for (const k of alive) {
      let pop = 0,
        sold = 0;
      for (const vid of k.villages) {
        const v = this.villages[vid];
        if (!v || !v.alive) continue;
        pop += v.pop;
        sold += v.jobCount.soldier || 0;
      }
      k.population = pop;
      k.soldiers = sold;
      k.strength = sold * 3 + pop * 0.6;
    }
    for (let i = 0; i < alive.length; i++)
      for (let j = i + 1; j < alive.length; j++) {
        const A = alive[i],
          B = alive[j];
        const r = this.rel(A.id, B.id);
        const border = this._borders.get(relKey(A.id, B.id)) || 0;
        r.border = border;
        const near = this._kingdomDistance(A, B);
        r.contact = border > 0 || near < 70;
        if (!r.contact && !r.war) {
          r.opinion *= 0.98;
          continue;
        }
        let target = 8;
        target -= Math.min(26, border * 0.32);
        if (near < 34) target -= (34 - near) * 0.3;
        const kin = baseCulture(A.culture) === baseCulture(B.culture);
        target += A.culture === B.culture ? 14 : this.law('diploCultureFriction') ? (kin ? -5 : -14) : 0;
        target -= (A.aggression + B.aggression) * 9;
        target -= r.grievance;
        if (r.ally) target += 30;
        const ra = g.units.byId.get(A.ruler),
          rb = g.units.byId.get(B.ruler);
        if (g.units.traitMod) target += ((ra ? g.units.traitMod(ra, 'diplomacy') : 1) + (rb ? g.units.traitMod(rb, 'diplomacy') : 1) - 2) * 20;
        if (A.parent === B.id || B.parent === A.id) target -= 8; // breakaway grudges
        const ea = this.enemiesOf(A.id),
          eb = this.enemiesOf(B.id);
        if (ea.some((e) => eb.includes(e))) target += 22;
        if (r.war) target -= 25;
        else {
          // long peace and trade build trust
          r.peaceT = (r.peaceT || 0) + 4;
          target += Math.min(30, (r.peaceT / YEAR) * 1.6);
          if (r.border > 0 && r.border < 30) target += 4;
        }
        if (r.war) r.peaceT = 0;
        // Radio: news and envoys travel fast, and opinion follows events sooner
        r.opinion += (target - r.opinion) * 0.12 * Math.max(this.techMod(A.id, 'diplomacy'), this.techMod(B.id, 'diplomacy'));
        r.opinion = clamp(r.opinion, -100, 100);
        r.grievance = Math.max(0, r.grievance - 0.25);
        if (this._relLocked?.(r)) continue;

        if (r.war) {
          this._considerPeace(A, B, r, now);
          continue;
        }
        if (r.ally && r.opinion < 5) {
          r.ally = false;
          this._note(`${this._kn(A)}–${this._kn(B)} alliance ends`, 'info', this._kingdomPos(A));
        }
        // alliance
        const charm = this._rulerTrait(A, 'gentle', 'silver-tongued', 'silvertongued') || this._rulerTrait(B, 'gentle', 'silver-tongued', 'silvertongued');
        if (this.law('civDiplomacy') && !r.ally && r.opinion > (charm ? 18 : 25) && (A.culture === B.culture || ea.some((e) => eb.includes(e)) || r.opinion > 32) && rng.chance(0.08)) {
          r.ally = true;
          this._note(`🤝 ${this._kn(A)} and ${this._kn(B)} ally`, 'good', this._kingdomPos(A));
          continue;
        }
        // war
        if (now < r.truceUntil || r.ally) continue;
        // the world's pace of war: crowns weigh a war for years, and a world
        // of twenty realms sees a new war every few years, not two a year
        // (Medium had 150-200 wars a century and realms lived 35 years)
        if (now - (this._lastAggression ?? -1e9) < this._warGap(alive.length)) continue;
        for (const [att, def] of [
          [A, B],
          [B, A],
        ]) {
          // a new crown is left to find its feet, and a crown that has just
          // fought, or just made peace, rebuilds before it fights again
          if (now - att.founded < YEAR * 15 || now - def.founded < YEAR * 15) continue;
          if (now - (att.lastAttack ?? -1e9) < YEAR * 16 || now - (att.lastPeace ?? -1e9) < YEAR * 10) continue;
          if (now - (def.lastPeace ?? -1e9) < YEAR * 6) continue;
          if (this.warCount(att.id) >= 2) continue;
          // a hegemon is sated (only in a settled world of 12+ villages, and a
          // realm of 5+): at two fifths of the villages, so a Medium realm of
          // nine no longer stops making war (conquests had fallen to 6-8 a
          // century in some centuries)
          if (this._aliveVillageCount() >= 12 && att.villages.length >= 5 && att.villages.length > 0.4 * this._aliveVillageCount()) continue;
          const ratio = att.strength / Math.max(1, def.strength);
          const crowd = this._crowd?.() || 0;
          const wl = this._kLaw(att.id, 'diploWarlike', 1);
          if (wl <= 0) continue;
          // the law and the age of the world both set how readily crowns go to war
          const wa = wl * (g.age?.mods?.warlike ?? 1);
          const hostile = r.opinion < -30 + crowd * 25 + (wa - 1) * 22;
          const ambitious = att.ambition > 0.55 && ratio > 1.6 / Math.sqrt(wa) && r.opinion < 0;
          // land hunger: a crowded world with a weaker neighbour on the border
          const hungry = border > 6 && ratio > 1.3 / Math.sqrt(wa) && now - att.lastWar > YEAR * 8 / wa && r.opinion < 30 + (wa - 1) * 15 && crowd > 0.5 / wa;
          if (!hostile && !ambitious && !hungry) continue;
          if (ratio < 0.6) continue;
          // a real country seeded at the start is not set upon by every
          // neighbour in its first decades, nor beaten down to its last town
          // by two wars at once
          const youngReal = def.seeded && now - def.founded < YEAR * 40;
          if (def.seeded && this.warCount(def.id) >= (def.villages.length <= 1 ? 1 : 2)) continue;
          let p = 0.02 + att.aggression * 0.045 + (ambitious ? 0.025 : 0) + (hungry ? 0.02 + crowd * 0.025 : 0);
          if (def.seeded) p *= (youngReal ? 0.85 : 1) * (def.villages.length <= 1 ? 0.85 : 1);
          p *= Math.pow(wl, 1.7) * (g.age?.mods?.warlike ?? 1);
          if (this._rulerTrait(att, 'cruel', 'valiant')) p *= 1.6;
          if (this._rulerTrait(att, 'gentle', 'silver-tongued', 'silvertongued')) p *= 0.55;
          if (this.hasCultureTrait(att.culture, 'Martial')) p *= 1.3;
          if (!rng.chance(p)) continue;
          let reason;
          if ((ambitious && ratio > 1.6 && att.ambition > 0.7) || (hungry && !hostile)) reason = 'ambition';
          else if (border > 12) reason = 'border';
          else if (att.culture !== def.culture) {
            // an old enmity needs an old crown on both sides: a realm of a few
            // years has no feud to settle
            if (now - att.founded < YEAR * 30 || now - def.founded < YEAR * 30) continue;
            reason = 'culture';
          } else reason = 'border';
          if (!this.declareWar(att.id, def.id, reason)) continue;
          att.lastAttack = now;
          this._lastAggression = now;
          break;
        }
      }
  },

  // A realm's people (alive members of its villages), counted on the spot:
  // the diplomacy pass refreshes k.population only every few seconds, so a
  // realm card opened at load read 0.
  _kingdomPop(k) {
    let n = 0;
    for (const vid of k.villages) {
      const v = this.villages[vid];
      if (v?.alive) for (const u of v.members) if (u.alive) n++;
    }
    return n;
  },

  // Fill in every realm's population and soldiers right after the start (the
  // diplomacy pass keeps them current from then on).
  _kingdomTotals() {
    for (const k of this.kingdoms) {
      if (!k.alive) continue;
      let pop = 0,
        sold = 0;
      for (const vid of k.villages) {
        const v = this.villages[vid];
        if (!v?.alive) continue;
        for (const u of v.members) {
          if (!u.alive) continue;
          pop++;
          if (u.job === 'soldier') sold++;
        }
      }
      k.population = pop;
      k.soldiers = sold;
    }
  },

  _kingdomDistance(A, B) {
    let best = Infinity;
    for (const va of A.villages) {
      const a = this.villages[va];
      if (!a?.alive) continue;
      for (const vb of B.villages) {
        const b = this.villages[vb];
        if (!b?.alive) continue;
        const d = geoDist(this.world, a.cx, a.cz, b.cx, b.cz);
        if (d < best) best = d;
      }
    }
    return best;
  },

  _kingdomPos(k) {
    const v = this.villages[k.capital];
    return v ? { x: v.cx, z: v.cz } : null;
  },

  // Game seconds between two wars of conquest anywhere in the world: about
  // one a year for every forty realms (rebellions and allies joining in come
  // on top), never less often than one in eight years.
  _warGap(nAlive) {
    return (YEAR * 1) / Math.max(0.125, nAlive * 0.025);
  },

  declareWar(a, b, reason = 'border', silent = false) {
    if (a === b) return false;
    if (reason !== 'god' && !this.law('civWars')) return false;
    const A = this.kingdoms[a],
      B = this.kingdoms[b];
    if (!A?.alive || !B?.alive) return false;
    const r = this.rel(a, b);
    if (r.war) return false;
    r.war = true;
    r.ally = false;
    r.warSince = this.game.time.total;
    r.sieged = false;
    r.conquests = 0;
    r.reason = reason;
    r.attacker = a;
    r.losses = [0, 0];
    r.startPop = [A.population || 1, B.population || 1];
    r.lossBase = { [A.id]: A.warLosses, [B.id]: B.warLosses };
    r.opinion = Math.min(r.opinion, -40);
    A.lastWar = B.lastWar = this.game.time.total;
    const why = { border: 'border dispute', culture: 'old enmity', ambition: 'conquest', rebellion: 'rebellion', alliance: 'alliance', god: 'divine will' }[reason] || 'grievance';
    if (!silent) this._note(`⚔ ${this._kn(A)} declares war on ${this._kn(B)} (${why})`, 'war', this._kingdomPos(B));
    const ra = this.game.units.byId.get(A.ruler),
      rb = this.game.units.byId.get(B.ruler);
    if (ra) this._bio(ra, `Declared war on ${this._kn(B)}`);
    if (rb) this._bio(rb, `${this._kn(A)} declared war on us`);
    const pb = this._kingdomPos(B);
    this._sfx('war-horn', pb?.x ?? 0, pb?.z ?? 0, 0, true);
    // allies of the defender may join
    if (reason !== 'alliance') {
      for (const k of this.kingdoms) {
        if (!k.alive || k.id === a || k.id === b) continue;
        const joined = this.enemiesOf(a).length - 1;
        if (joined >= 3 || (B.population || 0) > (A.population || 0) * 2) break;
        if (this._relLocked?.(this.relations.get(relKey(k.id, a)))) continue;
        // a realm sworn to peace (warlike 0) keeps out of its allies' wars
        if (this._kLaw(k.id, 'diploWarlike', 1) <= 0) continue;
        if (this.allied(k.id, b) && !this.allied(k.id, a) && this.warCount(k.id) < 2 && this.rng.chance(this.hasTech(k.id, 'radio') ? 0.9 : 0.7)) {
          const rr = this.rel(k.id, a);
          if (!rr.war) {
            rr.war = true;
            rr.ally = false;
            rr.warSince = this.game.time.total;
            rr.reason = 'alliance';
            rr.sieged = false;
            rr.conquests = 0;
            rr.attacker = k.id;
            rr.losses = [0, 0];
            rr.startPop = [k.population || 1, A.population || 1];
            this._note(`⚔ ${this._kn(k)} joins its ally against ${this._kn(A)}`, 'war', this._kingdomPos(k));
          }
        }
      }
    }
    return true;
  },

  makePeace(a, b, silent = false) {
    const r = this.relations.get(relKey(a, b));
    if (!r || !r.war) return false;
    r.war = false;
    r.truceUntil = this.game.time.total + YEAR * 8;
    r.grievance = Math.min(60, r.grievance + 15);
    r.opinion = Math.max(r.opinion, -10);
    for (const army of this.armies) {
      if ((army.kingdom === a && army.enemy === b) || (army.kingdom === b && army.enemy === a)) this._disbandArmy(army);
    }
    const A = this.kingdoms[a],
      B = this.kingdoms[b];
    if (A) A.lastPeace = this.game.time.total;
    if (B) B.lastPeace = this.game.time.total;
    if (!silent && A && B) this._note(`🕊 Peace between ${this._kn(A)} and ${this._kn(B)}`, 'good', this._kingdomPos(A));
    return true;
  },

  _considerPeace(A, B, r, now) {
    if (!this.law('diploPeace')) return; // no treaties: wars end only by the sword
    const dur = now - r.warSince;
    // war weariness: the dead weigh on both crowns
    const killedA = A.warLosses - (r.lossBase?.[A.id] ?? A.warLosses);
    const killedB = B.warLosses - (r.lossBase?.[B.id] ?? B.warLosses);
    const wearyA = killedA / Math.max(8, r.startPop[r.a === A.id ? 0 : 1]);
    const wearyB = killedB / Math.max(8, r.startPop[r.a === A.id ? 1 : 0]);
    const weary = Math.max(wearyA, wearyB);
    // a war runs its campaign: no talks until an army has laid siege, or years pass
    const campaign = r.sieged || dur > YEAR * 7;
    if (weary > 0.3 && dur > YEAR * 3 && campaign) return this.makePeace(A.id, B.id);
    if (dur < YEAR * 4 || !campaign) return;
    // without diplomacy, wars end only in exhaustion
    if (!this.law('civDiplomacy')) return;
    const lossA = r.startPop[r.a === A.id ? 0 : 1] - A.population;
    const lossB = r.startPop[r.a === A.id ? 1 : 0] - B.population;
    const popWeary = Math.max(lossA / Math.max(1, r.startPop[0]), lossB / Math.max(1, r.startPop[1]));
    let p = 0.007 + Math.max(0, popWeary) * 0.2 + weary * 0.4 + Math.max(0, dur - YEAR * 10) / (YEAR * 120) + (r.conquests || 0) * 0.03; // a victor with new towns is sated
    if (!this._reachable(A, B)) p += 0.08;
    if (this._rulerTrait(A, 'gentle', 'silver-tongued', 'silvertongued') || this._rulerTrait(B, 'gentle', 'silver-tongued', 'silvertongued')) p *= 1.8;
    if (this._rulerTrait(A, 'cruel') || this._rulerTrait(B, 'cruel')) p *= 0.6;
    if (this.rng.chance(p)) this.makePeace(A.id, B.id);
  },

  _reachable(A, B) {
    for (const va of A.villages) {
      const a = this.villages[va];
      if (!a?.alive) continue;
      for (const vb of B.villages) {
        const b = this.villages[vb];
        if (b?.alive && b.landId === a.landId) return true;
      }
    }
    return false;
  },

  // ---------------------------------------------------------------- armies
  // The laws of the world forbid war: every war ends in an armistice.
  _endAllWars() {
    let n = 0;
    for (const r of this.relations.values()) {
      if (!r.war) continue;
      this.makePeace(r.a, r.b, true);
      n++;
    }
    for (const a of [...this.armies]) this._disbandArmy(a);
    this.battles = [];
    if (n) this._note(`⚖ War is outlawed: ${n === 1 ? 'the war ends' : n + ' wars end'} in armistice`, 'good', null, 'outlaw', 30);
  },

  _wars() {
    const now = this.game.time.total;
    if (!this.law('civWars')) {
      if (this.armies.length || [...this.relations.values()].some((r) => r.war && r.reason !== 'god')) this._endAllWars();
      return;
    }
    // spawn armies for kingdoms at war that have none
    for (const k of this.kingdoms) {
      if (!k.alive) continue;
      const enemies = this.enemiesOf(k.id);
      if (!enemies.length) continue;
      if (this.armies.some((a) => a.kingdom === k.id)) continue;
      if (now - (k.lastArmy || -999) < 12) continue;
      // nearest reachable enemy village
      let best = null,
        bd = Infinity,
        home = null;
      for (const vid of k.villages) {
        const v = this.villages[vid];
        if (!v?.alive) continue;
        for (const e of enemies) {
          for (const evid of this.kingdoms[e].villages) {
            const ev = this.villages[evid];
            if (!ev?.alive || ev.landId !== v.landId) continue;
            const d = geoDist(this.world, ev.cx, ev.cz, v.cx, v.cz);
            if (d < bd) {
              bd = d;
              best = ev;
              home = v;
            }
          }
        }
      }
      if (!best) continue;
      this._raiseArmy(k, home, best);
    }
    for (const a of [...this.armies]) this._updateArmy(a, now);
    // active battles (for the crossed-swords markers)
    const battles = [];
    for (const a of this.armies) {
      if (a.dead || a.state === 'gather') continue;
      let fighting = 0,
        x = 0,
        z = 0;
      for (const u of a.units) {
        if (u.combat || u.state === 'attack') {
          fighting++;
          x += u.x;
          z += u.z;
        }
      }
      if (fighting >= 2) battles.push({ x: x / fighting, z: z / fighting, a: a.kingdom, b: a.enemy, n: fighting, siege: a.state === 'siege' });
    }
    this.battles = battles;
  },

  _raiseArmy(k, home, target) {
    const soldiers = [];
    for (const vid of k.villages) {
      const v = this.villages[vid];
      if (!v?.alive || v.landId !== home.landId) continue;
      if (geoDist(this.world, v.cx, v.cz, home.cx, home.cz) > 70) continue;
      const own = [...v.members].filter((u) => u.alive && u.job === 'soldier' && !u.data.civ?.army);
      const keep = v === home ? 1 : 1;
      for (let i = keep; i < own.length; i++) soldiers.push(own[i]);
    }
    k.lastArmy = this.game.time.total;
    const cap = Math.min(32, Math.max(18, Math.round(soldiers.length * 0.8)));
    if (soldiers.length > cap) soldiers.length = cap;
    if (soldiers.length < 8) {
      // not enough men under arms yet: draft more soldiers in the home village
      home.draft = this.game.time.total;
      return null;
    }
    const dx = target.cx - home.cx,
      dz = target.cz - home.cz;
    const l = Math.hypot(dx, dz) || 1;
    const rally = { x: home.cx + (dx / l) * Math.min(home.radius * 0.6, l * 0.3), z: home.cz + (dz / l) * Math.min(home.radius * 0.6, l * 0.3) };
    const army = {
      id: this._nextArmy++,
      kingdom: k.id,
      enemy: target.kingdom,
      target: target.id,
      home: home.id,
      state: 'gather',
      units: new Set(),
      rally,
      t: this.game.time.total,
      announced: false,
    };
    soldiers.sort((a, b) => Math.hypot(a.x - rally.x, a.z - rally.z) - Math.hypot(b.x - rally.x, b.z - rally.z));
    for (const u of soldiers) {
      army.units.add(u);
      u.data.civ.army = army.id;
      u.data.civ.task = null;
    }
    army.bearer = soldiers[0].id;
    const march = this.techMod(k.id, 'march');
    if (march !== 1) for (const u of soldiers) u.data.speedMul = march;
    this.armies.push(army);
    return army;
  },

  _disbandArmy(a) {
    const fought = a.state === 'siege' || a.state === 'march';
    for (const u of a.units) {
      if (u.data?.civ) u.data.civ.army = null;
      if (fought && u.alive) {
        this.game.units.addXP?.(u, 8);
        u.data.speedMul = null;
      }
    }
    a.dead = true;
    a.units.clear();
    const i = this.armies.indexOf(a);
    if (i >= 0) this.armies.splice(i, 1);
  },

  armyOf(u) {
    const id = u.data.civ?.army;
    if (id == null) return null;
    return this.armies.find((a) => a.id === id) || null;
  },

  _updateArmy(a, now) {
    for (const u of [...a.units]) if (!u.alive || u.kingdom !== a.kingdom) a.units.delete(u);
    const target = this.villages[a.target];
    if (!this.atWar(a.kingdom, a.enemy) || !this.kingdoms[a.kingdom]?.alive) return this._disbandArmy(a);
    if (!a.units.size) {
      const k = this.kingdoms[a.kingdom];
      if (a.state !== 'gather' && a.size0 >= 6) this._note(`${this._kn(k)} army routed at ${target ? target.name : 'the front'}`, 'war', target ? { x: target.cx, z: target.cz } : null, 'rout' + a.kingdom, 90);
      return this._disbandArmy(a);
    }
    // a new standard-bearer picks up a fallen banner
    if (!a.units.has(this.game.units.byId.get(a.bearer))) a.bearer = a.units.values().next().value.id;
    if (!target || !target.alive || target.kingdom !== a.enemy) {
      // pick another target of the same enemy, else go home
      const k = this.kingdoms[a.kingdom];
      let best = null,
        bd = Infinity;
      const c = this._armyCentre(a);
      for (const e of this.enemiesOf(a.kingdom)) {
        for (const evid of this.kingdoms[e].villages) {
          const ev = this.villages[evid];
          if (!ev?.alive || ev.landId !== (a.landId ?? this.villages[a.home]?.landId)) continue;
          const d = geoDist(this.world, ev.cx, ev.cz, c.x, c.z);
          if (d < bd) {
            bd = d;
            best = ev;
          }
        }
      }
      if (!best || bd > 120) return this._disbandArmy(a);
      a.target = best.id;
      a.enemy = best.kingdom;
      a.state = 'march';
      a.t = now;
      return;
    }
    if (a.state === 'gather') {
      let n = 0;
      for (const u of a.units) if (Math.hypot(u.x - a.rally.x, u.z - a.rally.z) < 5) n++;
      if (n >= a.units.size * 0.7 || now - a.t > 25) {
        a.state = 'march';
        a.t = now;
        const k = this.kingdoms[a.kingdom];
        a.size0 = a.units.size;
        this._note(`${this._kn(k)} army (${a.units.size}) marches on ${target.name}`, 'war', { x: a.rally.x, z: a.rally.z }, 'march' + a.kingdom, 120);
      }
    } else if (a.state === 'march') {
      const c = this._armyCentre(a);
      if (Math.hypot(c.x - target.cx, c.z - target.cz) < target.radius * 0.7) {
        a.state = 'siege';
        a.t = now;
        const rr = this.relations.get(relKey(a.kingdom, target.kingdom));
        if (rr) rr.sieged = true;
      }
      if (now - a.t > 260) this._disbandArmy(a);
    } else if (a.state === 'siege') {
      // capture once the hall is broken and defenders are gone
      const hall = target.hall;
      const defenders = this.game.units.query(target.cx, target.cz, target.radius * 0.8, (o) => o.kingdom === target.kingdom && o.job === 'soldier' && o.species === 'human');
      const hallDown = !hall || !hall.alive || hall.hp < hall.maxHp * 0.35;
      let near = 0;
      if (hallDown && defenders.length) for (const u of a.units) if (Math.hypot(u.x - target.cx, u.z - target.cz) < target.radius) near++;
      if (hallDown && (defenders.length === 0 || near >= defenders.length * 3)) this._capture(a, target);
      else if (now - a.t > 260) this._disbandArmy(a);
    }
  },

  _armyCentre(a) {
    let x = 0,
      z = 0,
      n = 0;
    for (const u of a.units) {
      x += u.x;
      z += u.z;
      n++;
    }
    return n ? { x: x / n, z: z / n } : { x: 0, z: 0 };
  },

  _capture(a, v) {
    const K = this.kingdoms[a.kingdom];
    const old = this.kingdoms[v.kingdom];
    // a seeded country's seat or a city that must exist, in the first
    // century: the city holds, and its country buys peace with tribute
    // (a war of the gods' or a player's own realm still takes it)
    const rw = this.relations.get(relKey(K.id, old.id));
    // a newborn crown (a rebel, a breakaway, settlers on their own) is not
    // taken back in its first fifteen years: its town holds and the attacker
    // makes peace (one fallen realm in five had lived under ten years, most
    // of them rebels retaken by the realm they had left)
    const now0 = this.game.time.total;
    if (K !== old && now0 - old.founded < YEAR * REALM_GRACE && rw?.reason !== 'god' && !K.player?.name) {
      const r = this.rel(K.id, old.id);
      this._note(`🛡 ${v.name} holds out; ${this._kn(old)} keeps its young crown`, 'war', { x: v.cx, z: v.cz }, 'young' + old.id, 30);
      if (!this.makePeace(K.id, old.id, true)) this._disbandArmy(a);
      r.truceUntil = Math.max(r.truceUntil || 0, old.founded + YEAR * (REALM_GRACE + 5));
      return;
    }
    if (this._keyFirm?.(v) && K !== old && rw?.reason !== 'god' && !K.player?.name) {
      const inv = old.inventory || {};
      const gold = Math.floor((inv.gold || 0) * 0.5),
        food = Math.floor((inv.food || 0) * 0.3);
      if (inv.gold != null) inv.gold -= gold;
      if (inv.food != null) inv.food -= food;
      if (K.inventory) {
        K.inventory.gold = (K.inventory.gold || 0) + gold;
        K.inventory.food = (K.inventory.food || 0) + food;
      }
      const r = this.rel(K.id, old.id);
      this._note(`🛡 ${v.name} holds out; ${this._kn(old)} buys peace from ${this._kn(K)}`, 'war', { x: v.cx, z: v.cz });
      if (!this.makePeace(K.id, old.id, true)) this._disbandArmy(a);
      r.truceUntil = Math.max(r.truceUntil || 0, this.game.time.total + YEAR * 12);
      return;
    }
    const raze = K.culture !== old.culture && K.aggression > 0.7 && this.rng.chance(0.35) && v.id !== old.capital && !this._keyCity?.(v);
    const r = this.rel(K.id, old.id);
    r.grievance = Math.min(80, r.grievance + 25);
    r.conquests = (r.conquests || 0) + 1;
    if (raze) {
      this._note(`🔥 ${this._kn(K)} burns ${v.name}`, 'war', { x: v.cx, z: v.cz });
      for (const b of v.buildings) if (b.alive) b.burning = Math.max(b.burning, 0.7 + this.rng.next() * 0.3);
      v.razed = true;
      for (const u of [...v.members]) if (u.job !== 'soldier') this._makeRefugee(u, old);
    } else {
      this._transferVillage(v, K.id, 'conquest');
      // garrison
      let n = 0;
      for (const u of [...a.units]) {
        if (n >= 2) break;
        a.units.delete(u);
        u.data.civ.army = null;
        this._moveMember(u, v);
        n++;
      }
    }
    a.state = 'march';
    a.t = this.game.time.total;
  },

  _makeRefugee(u, kingdom) {
    // flee to another village of the same kingdom, else wander
    let best = null,
      bd = Infinity;
    for (const vid of kingdom.villages) {
      const v = this.villages[vid];
      if (!v?.alive || v.id === u.village || v.razed) continue;
      const d = geoDist(this.world, v.cx, v.cz, u.x, u.z);
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    if (best) this._moveMember(u, best);
    else this._removeMember(u);
  },

  // Change a village's allegiance (conquest, rebellion, gift).
  _transferVillage(v, kid, cause = 'conquest') {
    const old = this.kingdoms[v.kingdom];
    const K = this.kingdoms[kid];
    if (!K) return;
    // World Map: the first real country to hold a town is its home
    if (old && v.home == null && old.realm >= 0) v.home = old.id;
    if (old) {
      old.villages = old.villages.filter((id) => id !== v.id);
    }
    v.kingdom = kid;
    K.villages.push(v.id);
    v.conqueredAt = this.game.time.total;
    v.loyalty = cause === 'rebellion' ? 80 : cause === 'union' ? 75 : 35;
    if (cause === 'conquest' && (v.rebellions || 0) >= 2) v.loyaltyBoost = Math.max(v.loyaltyBoost || 0, 12); // a restless town is garrisoned and watched
    for (const b of v.buildings) {
      if (BUILDING_TYPES[b.type]?.monument && b.alive && old && K && old !== K && cause === 'conquest') {
        // a monument changes hands with its town: a moment for the chronicle
        this._note(`🏛 ${this._kn(K)} takes the ${buildingLabel(b)} of ${v.name}`, 'war', { x: b.x, z: b.z }, 'montaken' + b.id, 60);
      }
      b.kingdom = kid;
    }
    for (const u of v.members) {
      u.kingdom = kid;
      if (u.job === 'king') u.job = null;
    }
    if (old && old.ruler >= 0) {
      const ru = this.game.units.byId.get(old.ruler);
      if (ru && ru.village === v.id && cause === 'conquest') {
        this._note(`${ru.name} captured at ${v.name}`, 'war', { x: v.cx, z: v.cz });
        this.game.units.kill(ru, 'executed');
      }
    }
    if (cause === 'conquest') {
      this._note(`⚑ ${this._kn(K)} conquers ${v.name}`, 'war', { x: v.cx, z: v.cz });
      const rk = this.game.units.byId.get(K.ruler);
      if (rk) this._bio(rk, `Conquered ${v.name}`);
      // the conquerors bring their tongue
      this._mixAdd?.(v, K.culture, 0.25);
    }
    // the hall changes hands visibly: new colours run up with a flourish
    const hb = v.hall;
    if (hb) {
      this.game.fx?.burst?.('magic', { x: hb.x, z: hb.z }, 14, { scale: 1.6, color: K.color });
      this._sfx?.(cause === 'conquest' ? 'war-horn' : 'bell', hb.x, hb.z, 1);
    }
    this.version++;
    this.colorVersion++;
    if (old && old.alive) {
      if (!old.villages.length) {
        const seat = cause === 'conquest' && old !== K ? this._courtInExile?.(old, v) : null;
        if (seat) this._exiled(old, K, v, seat);
        else this._killKingdom(old, cause);
      } else if (old.capital === v.id) {
        const nc = this._chooseCapital(old);
        if (nc) this._note(`${this._kn(old)} moves its capital to ${nc.name}`, 'info', { x: nc.cx, z: nc.cz });
        const ru = this.game.units.byId.get(old.ruler);
        if (!ru || !ru.alive || ru.kingdom !== old.id) this._succession(old, old.rulerName || 'The ruler');
      }
    }
    if (K.capital < 0 || !this.villages[K.capital]?.alive) this._chooseCapital(K);
  },

  // A real country's court has fled its fallen seat (realms.js
  // _courtInExile): a ruler is found at the new seat, and the conqueror,
  // sated, makes a long peace.
  _exiled(k, K, lost, seat) {
    this._note(`👑 ${lost.name} falls; the court of ${this._kn(k)} flees to ${seat.name}`, 'war', { x: seat.cx, z: seat.cz });
    const ru = this.game.units.byId.get(k.ruler);
    if (!ru || !ru.alive || ru.kingdom !== k.id) {
      if (ru?.alive) this._uncrown(ru);
      k.ruler = -1;
      this._succession(k, k.rulerName || 'The ruler');
    }
    if (this.atWar(K.id, k.id)) {
      this.makePeace(K.id, k.id, true);
      this.rel(K.id, k.id).truceUntil = this.game.time.total + YEAR * 12;
    }
    for (const e of this.enemiesOf(k.id)) {
      const r = this.rel(e, k.id);
      if (this.game.time.total - r.warSince > YEAR * 3) this.makePeace(e, k.id, true);
    }
  },

  // ---------------------------------------------------------------- loyalty & rebellion
  _loyalty(v) {
    const now = this.game.time.total;
    const k = this.kingdoms[v.kingdom];
    if (!k) return;
    if (k.capital === v.id) {
      v.loyalty = 100;
      return;
    }
    const cap = this.villages[k.capital];
    const alive = this._aliveKingdoms();
    let L = 74;
    // distance from the crown; a colony over the sea is governed by ship, so
    // the open water counts for little (otherwise every World Map colony
    // rose the day it reached 14 people)
    if (cap) L -= Math.max(0, (geoDist(this.world, cap.cx, cap.cz, v.cx, v.cz) * (v.colony && (v.colonyOf ?? v.kingdom) === v.kingdom && v.landId !== cap.landId ? 0.3 : 1)) / Math.max(1, Math.sqrt(this.world.size / 65536)) - 28) * 0.75;
    if (v.culture !== k.culture) L -= 18;
    if (v.conqueredAt) L -= Math.max(0, 34 - ((now - v.conqueredAt) / YEAR) * 3);
    if (v.starving && this.law('harmonyUnrest')) L -= 22;
    if (this.warCount(k.id) > 0 && this.law('harmonyUnrest')) L -= 6;
    if (now < k.interregnumUntil) L -= 18;
    if (now < k.goldenUntil) L += 30;
    if (v.buildings.some((b) => b.alive && b.type === 'temple' && !b.constructing)) L += 8;
    if (v.tier >= 1 && cap && v.pop > cap.pop * 0.8) L -= 14; // rival city
    if (v.tier >= 2) L -= 6; // proud cities chafe under distant rule
    // overstretched realm (a real country on a World Map world holds a
    // country's worth of towns before it strains: Europe and Japan's
    // regions were splintering into one-town crowns)
    const realK = k.realm >= 0 && this._realMapOn?.();
    if (realK) L -= Math.max(0, k.villages.length - 7) * 4;
    else if (k.villages.length > 3) L -= (k.villages.length - 3) * 6;
    // a crowded, capped world turns ambition inward: provinces want their own crown
    L -= (this._crowd?.() || 0) * 12;
    if (alive < 3) L -= 14; // a world of two empires is a powder keg
    if (alive >= 7) L += 12;
    if (this.law('harmonyUnrest') && v.famineT && now - v.famineT < YEAR * 4) L -= 10;
    L += (this.law('harmonyLoyalty', 1) * (this.game.age?.mods?.harmony ?? 1) - 1) * 35;
    L += this.techAdd(k.id, 'loyalty');
    if (this.hasCultureTrait(v.culture, 'Mystic')) L += 5;
    // World Map: a real country's own towns hold to it; a town taken from a
    // real country that still stands longs to go back
    if (k.realm >= 0 && (v.home == null || v.home === k.id)) L += k.seeded ? 5 : 3;
    else if (v.home != null && v.home !== k.id && this._homeRealm?.(v)) L -= 8;
    L += (v.loyaltyBoost || 0);
    v.loyaltyBoost = Math.max(0, (v.loyaltyBoost || 0) - 1);
    v.loyalty = clamp(v.loyalty + (L - v.loyalty) * 0.2, 0, 100);
    // (firmer since round 15: Medium saw 50-70 risings a century, each one a
    // new crown that lived a few years; a realm of under fifteen years is
    // still finding its feet and its towns give it time)
    if (v.loyalty < 30 && v.pop >= (this.world.size > 100000 ? 14 : 10)) v.unrest = (v.unrest || 0) + 1;
    else v.unrest = Math.max(0, (v.unrest || 0) - 1);
    // (halved again: a rising was still the birth of most realms, and most
    // lived twenty-odd years; realms averaged 52 years by Year 300)
    // (round 23: a world of sixteen or more realms rises less often still;
    // the mid eras saw 51-53 risings a century against 41 in round 20)
    if (v.unrest >= 4 && now - k.founded >= YEAR * 15 && this._kLaw(k.id, 'civRebellions') && this.rng.chance(alive < 3 ? 0.2 : alive >= 16 ? 0.03 : alive >= 12 ? 0.045 : 0.07)) this.rebel(v);
  },

  _aliveKingdoms() {
    let n = 0;
    for (const k of this.kingdoms) if (k.alive && k.villages.length) n++;
    return n;
  },

  // Peaceful secession: a big realm in a crowded world lets a distant province go.
  _secession() {
    if (!this.law('civRebellions') || !this.law('harmonySecession')) return;
    const alive = this._aliveKingdoms();
    if (alive >= 6) return;
    const now = this.game.time.total;
    if (now - (this._lastSecession || -999) < YEAR * (alive < 3 ? 3 : 8)) return;
    let bestK = null;
    for (const k of this.kingdoms) if (k.alive && k.villages.length >= 4 && (!bestK || k.villages.length > bestK.villages.length)) bestK = k;
    if (!bestK || !this._kLaw(bestK.id, 'civRebellions')) return;
    const p = (alive < 3 ? 0.35 : 0.08) + (this._crowd?.() || 0) * 0.15 + (bestK.villages.length - 4) * 0.05;
    if (!this.rng.chance(p)) return;
    const cap = this.villages[bestK.capital];
    let far = null,
      fd = -1;
    for (const vid of bestK.villages) {
      const v = this.villages[vid];
      if (!v?.alive || vid === bestK.capital || v.pop < 8 || this._keyHeld?.(v)) continue;
      const d = cap ? geoDist(this.world, cap.cx, cap.cz, v.cx, v.cz) : 0;
      const sc = d + (100 - v.loyalty) * 0.4 + v.pop * 0.2;
      if (sc > fd) {
        fd = sc;
        far = v;
      }
    }
    if (!far) return;
    this._lastSecession = now;
    const old = bestK;
    const K = this.rebel(far, true);
    if (!K) return;
    // amicable at first; border friction decides what happens next
    const r = this.rel(K.id, old.id);
    if (r.war && this.rng.chance(0.55)) {
      this.makePeace(K.id, old.id, true);
      r.truceUntil = now + YEAR * 4;
      this._note(`👑 ${far.name} secedes peacefully from ${this._kn(old)} as ${this._theK(K)}`, 'info', { x: far.cx, z: far.cz });
    } else this._note(`✊ ${far.name} breaks away from ${this._kn(old)}: ${this._theK(K)}`, 'war', { x: far.cx, z: far.cz });
  },

  _rulerTrait(k, ...ids) {
    const u = this.game.units.byId.get(k?.ruler);
    if (!u || !this.game.units.hasTrait) return false;
    return ids.some((id) => this.game.units.hasTrait(u, id));
  },

  _kn(k) {
    return k ? k.base || k.name : 'nobody';
  },

  // A village breaks away as a new kingdom (optionally taking neighbours along).
  rebel(v, silent = false, forced = false) {
    const old = this.kingdoms[v.kingdom];
    if (!old || old.capital === v.id) return null;
    const now = this.game.time.total;
    // a crushed rebellion is remembered: the town needs years to rise again,
    // longer after every rising, though deep grievance shortens the wait
    const wait = YEAR * Math.min(36, 12 + 6 * (v.rebellions || 0)) * (v.loyalty < 12 ? 0.5 : 1);
    if (!forced && now - (v.lastRebel ?? -1e9) < wait) return null;
    // World Map: a town taken from a real country that still stands rises to
    // go back to it rather than to crown a realm of its own
    const home = forced ? null : this._homeRealm?.(v);
    if (home && home.id !== old.id) return this._riseHome(v, old, home, silent);
    if (!forced && this._keyHeld?.(v)) return null; // a seat or must-exist city stays loyal its first century
    // World Map: a town in the land of another real country that stands
    // rises to join it rather than to crown a realm named after itself
    const land = forced ? null : this._landRealm?.(v);
    if (land && land.id !== old.id && !land.player?.name) return this._riseHome(v, old, land, silent);
    // a realm rides out one rising at a time (a real country seeded at the
    // start four years, any other three: risings came in chains)
    if (!forced && now - (old.rebelT ?? -1e9) < YEAR * (old.seeded ? 4 : 3)) return null;
    // the towns that would rise with it (decided now, so a lone small town
    // knows whether it can stand as a realm)
    const joiners = [];
    let people = v.pop;
    for (const vid of old.villages) {
      const o = this.villages[vid];
      if (!o?.alive || o === v || o.id === old.capital || this._keyHeld?.(o)) continue;
      if (geoDist(this.world, o.cx, o.cz, v.cx, v.cz) < (this._civilWar ? 55 : 34) && o.loyalty < (this._civilWar ? 65 : 40) && this.rng.chance(0.6)) {
        joiners.push(o);
        people += o.pop;
      }
    }
    // (a god's incitement always crowns its realm)
    if (!joiners.length && people < REALM_MIN_POP && !v.player && (!forced || this._autoRise)) {
      this._riseSmall(v, old, silent);
      return null; // no new crown (callers declare war only on a new one)
    }
    old.rebelT = now;
    v.lastRebel = now;
    v.rebellions = (v.rebellions || 0) + 1;
    const fallen = this._realMapOn?.() && this.kingdoms.some((k) => k.realm >= 0 && !k.alive);
    const K = this.createKingdom(v.culture, { baseName: v.name, parent: old.id, x: v.cx, z: v.cz, home: v.home });
    const oldName = old.base || old.name;
    const again = fallen && K.realm >= 0 && this.kingdoms.some((k) => k !== K && k.realm === K.realm && !k.alive);
    this._transferVillage(v, K.id, 'rebellion');
    K.capital = v.id;
    v.unrest = 0;
    // pick a leader
    let leader = null;
    for (const u of v.members) if (u.alive && u.age >= ADULT_AGE + 2 && (!leader || (u.job === 'soldier') > (leader.job === 'soldier') || u.age > leader.age)) leader = u;
    if (leader) this.crown(K, leader);
    if (!silent) this._note(again ? `✊ ${v.name} rebels against ${oldName}: ${K.name} rises again` : `✊ ${v.name} rebels against ${oldName}: ${this._theK(K)}`, 'war', { x: v.cx, z: v.cz });
    // discontented neighbours join
    for (const o of joiners) {
      if (!o.alive || o.kingdom !== old.id) continue;
      this._transferVillage(o, K.id, 'rebellion');
      this._note(`${o.name} joins the rebels`, 'war', { x: o.cx, z: o.cz }, 'joinreb' + K.id, 60);
    }
    if (old.alive) this.declareWar(K.id, old.id, 'rebellion', true);
    return K;
  },

  // A rising too small to stand as a realm (one town, under REALM_MIN_POP
  // people): it goes over to a neighbouring crown on its land (one at war
  // with its old master first, else the nearest), or, with none at hand,
  // wins concessions and stays. Returns the realm it now belongs to, or null.
  _riseSmall(v, old, silent) {
    const now = this.game.time.total;
    v.lastRebel = now;
    v.rebellions = (v.rebellions || 0) + 1;
    v.unrest = 0;
    let best = null,
      bs = -Infinity;
    const reach = 40 * Math.max(1, Math.sqrt(this.world.size / 65536));
    for (const k of this.kingdoms) {
      if (!k.alive || k === old || !k.villages.length || k.player?.name || !this._kLaw(k.id, 'civRebellions')) continue;
      let d = Infinity;
      for (const vid of k.villages) {
        const o = this.villages[vid];
        if (o?.alive && o.landId === v.landId) d = Math.min(d, geoDist(this.world, o.cx, o.cz, v.cx, v.cz));
      }
      if (d > reach) continue;
      const s = -d + (this.atWar(k.id, old.id) ? 30 : 0) + (k.culture === v.culture ? 12 : 0) + (k.realm >= 0 ? 6 : 0);
      if (s > bs) (bs = s), (best = k);
    }
    if (best) {
      this._transferVillage(v, best.id, 'rebellion');
      const r = this.rel(best.id, old.id);
      r.grievance = Math.min(80, r.grievance + 15);
      if (!silent) this._note(`✊ ${v.name} rises against ${this._kn(old)} and goes over to ${this._kn(best)}`, 'war', { x: v.cx, z: v.cz });
      return best;
    }
    v.loyalty = Math.max(v.loyalty, 55);
    v.loyaltyBoost = Math.max(v.loyaltyBoost || 0, 15);
    if (!silent) this._note(`✊ ${v.name} rises against ${this._kn(old)} and wins its charter`, 'info', { x: v.cx, z: v.cz }, 'charter' + v.id, 60);
    return null;
  },

  // A taken town rises and goes back to the real country it belongs to;
  // towns of the same country nearby may follow it.
  _riseHome(v, old, home, silent) {
    const now = this.game.time.total;
    v.lastRebel = now;
    v.rebellions = (v.rebellions || 0) + 1;
    const oldName = this._kn(old);
    this._transferVillage(v, home.id, 'rebellion');
    v.unrest = 0;
    if (!silent) this._note(`✊ ${v.name} rebels against ${oldName} and returns to ${this._kn(home)}`, 'war', { x: v.cx, z: v.cz });
    // a country's own capital, won back, is its seat again
    if (this._realmData?.()?.[home.realm]?.capital?.name === v.name && home.capital !== v.id) home.capital = v.id;
    for (const vid of [...old.villages]) {
      const o = this.villages[vid];
      if (!o?.alive || o.id === old.capital || o.home !== home.id) continue;
      if (geoDist(this.world, o.cx, o.cz, v.cx, v.cz) < 34 && o.loyalty < 45 && this.rng.chance(0.6)) {
        this._transferVillage(o, home.id, 'rebellion');
        this._note(`${o.name} follows it back to ${this._kn(home)}`, 'war', { x: o.cx, z: o.cz }, 'joinhome' + home.id, 60);
      }
    }
    if (old.alive) {
      const r = this.rel(home.id, old.id);
      r.grievance = Math.min(80, r.grievance + 20);
    }
    return home;
  },

  // The odds that settlers strike out as a realm of their own
  // (Civilization._settleExpedition): more often far from the capital. On a
  // World Map world a real country's settlers mostly stay loyal, so its own
  // towns, not a dozen splinter crowns, fill its land.
  _splinterOdds(k, far) {
    const p = far > 55 ? 0.3 : 0.05;
    if (!this._realMapOn?.()) return p;
    return p * (k?.realm >= 0 ? 0.3 : 0.6);
  },

  goldenAge(kid, years = 6) {
    const k = this.kingdoms[kid];
    if (!k?.alive) return false;
    k.goldenUntil = Math.max(this.game.time.total, k.goldenUntil) + YEAR * years;
    for (const vid of k.villages) {
      const v = this.villages[vid];
      if (!v?.alive) continue;
      v.loyalty = Math.min(100, v.loyalty + 25);
      for (const m of v.members) this.game.units.addStatus?.(m, 'inspired', 90);
      this.game.fx?.burst?.('sparkle', { x: v.cx, z: v.cz }, 12, { scale: 2 });
    }
    this._note(`✨ Golden age in ${this._kn(k)}`, 'good', this._kingdomPos(k));
    return true;
  },
};

export { relKey };
