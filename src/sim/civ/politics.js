import { CULTURES, HERALDRY, HERALDRY_AVOID, hueOf, baseCulture, placeName, kingdomName as makeKingdomName, rulerTitle } from './cultures.js';
import { BUILDING_TYPES } from './catalog.js';
import { YEAR, ADULT_AGE, clamp } from './util.js';

// Kingdoms, rulers, diplomacy (opinion, alliances, war), armies, conquest,
// rebellion and collapse. Mixed into Civilization.prototype.

const relKey = (a, b) => (a < b ? a * 4096 + b : b * 4096 + a);

export const politics = {
  // ---------------------------------------------------------------- kingdoms
  createKingdom(culture, opts = {}) {
    const rng = this.rng;
    const id = this.kingdoms.length;
    const used = new Set(this.kingdoms.filter((k) => k.alive).map((k) => k.color));
    // the tincture farthest in hue from every living realm (neighbours count double)
    const avoid = new Set(HERALDRY_AVOID[baseCulture(culture)] || []);
    const others = this.kingdoms.filter((k) => k.alive && k.villages.length);
    const near = (k) => {
      if (opts.x == null) return 1;
      const v = this.villages[k.capital];
      return v && Math.hypot(v.cx - opts.x, v.cz - opts.z) < 90 ? 2.2 : 1;
    };
    let her = null,
      bs = -Infinity;
    for (const h of HERALDRY) {
      if (avoid.has(h.name)) continue;
      const hh = hueOf(h.color);
      let score = 360;
      for (const k of others) {
        let dh = Math.abs(hueOf(k.color) - hh);
        if (dh > 180) dh = 360 - dh;
        if (k.color === h.color) dh = 0;
        // neighbours must differ most; distant realms may repeat a tincture
        score = Math.min(score, near(k) > 1 ? dh : dh + 75);
      }
      score += rng.next() * 6;
      if (score > bs) {
        bs = score;
        her = h;
      }
    }
    if (opts.color != null) her = HERALDRY.find((h) => h.color === opts.color) || her;
    if (!her) her = HERALDRY[id % HERALDRY.length];
    const base = opts.baseName || placeName(culture, rng, this.usedNames);
    const k = {
      id,
      name: opts.name || makeKingdomName(culture, base, rng),
      base,
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
    this._initTech(k);
    k.inventory = { food: 0, wood: 0, stone: 0, ore: 0, gold: 0, tools: 0, weapons: 0, armor: 0 };
    // a breakaway realm inherits what its parent knew
    const par = this.kingdoms[opts.parent];
    if (par?.techs) {
      for (const t of par.techs) k.techs.add(t);
      k.era = par.era;
    }
    this.kingdoms.push(k);
    this.colorVersion++;
    return k;
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

  crown(k, u) {
    if (!u) return;
    const title = rulerTitle(k.culture, u.sex);
    const base = u.data.civ?.given || u.name || 'Nameless';
    u.data.civ = u.data.civ || {};
    u.data.civ.given = base;
    u.name = `${title} ${base}`;
    u.job = 'king';
    u.data.civ.task = null;
    u.maxHp = Math.max(u.maxHp, 150);
    u.hp = Math.max(u.hp, 150);
    u.data.civ.royal = true;
    k.ruler = u.id;
    k.rulerName = u.name;
    k.council = false;
    this.game.units.log?.(u, `Crowned ${title} of the ${k.name}`);
    // name an heir straight away so the realm never drifts without one
    let heir = null;
    const v = this.villages[u.village];
    if (v) for (const m of v.members) if (m !== u && m.alive && m.age >= ADULT_AGE && (!heir || Math.abs(m.age - 24) < Math.abs(heir.age - 24))) heir = m;
    k.heir = heir ? heir.id : -1;
  },

  _succession(k, deadName) {
    const cap = this.villages[k.capital];
    let heir = null;
    const pools = [];
    if (cap && cap.alive) pools.push(cap);
    for (const vid of k.villages) if (vid !== k.capital) pools.push(this.villages[vid]);
    for (const v of pools) {
      if (!v || !v.alive) continue;
      for (const u of v.members) {
        if (!u.alive || u.age < ADULT_AGE) continue;
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
    if (cap) for (const m of cap.members) this.game.units.addStatus?.(m, 'mourning', 30);
    if (heir) {
      if (heir.village !== k.capital && cap && cap.alive) this._moveMember(heir, cap);
      this.crown(k, heir);
      this._note(`${deadName} dies; ${heir.name} rules ${this._kn(k)}`, 'info', { x: heir.x, z: heir.z }, 'succ' + k.id, 20);
      // a contested succession can split a large realm
      if (k.villages.length >= 3 && this.law('civRebellions') && this.rng.chance(0.3)) {
        let claimant = null;
        for (const vid of k.villages) {
          const v = this.villages[vid];
          if (!v?.alive || vid === k.capital) continue;
          if (!claimant || v.pop - v.loyalty * 0.3 > claimant.pop - claimant.loyalty * 0.3) claimant = v;
        }
        if (claimant && claimant.pop >= 10) {
          this._note(`Succession contested: ${claimant.name} defies ${heir.name}`, 'war', { x: claimant.cx, z: claimant.cz });
          this.rebel(claimant);
        }
      }
    } else {
      k.ruler = -1;
      k.interregnumUntil = this.game.time.total + YEAR * 5;
      this._note(`${deadName} dies heirless; a council of elders rules ${this._kn(k)}`, 'bad', cap ? { x: cap.cx, z: cap.cz } : null);
      k.council = true;
    }
  },

  _chooseCapital(k) {
    let best = null;
    for (const vid of k.villages) {
      const v = this.villages[vid];
      if (!v || !v.alive) continue;
      if (!best || v.pop > best.pop) best = v;
    }
    k.capital = best ? best.id : -1;
    return best;
  },

  _killKingdom(k, cause = 'fallen') {
    if (!k.alive) return;
    k.alive = false;
    this._noteCollapse?.((k.council ? 'heirless/' : '') + cause);
    for (const r of this.relations.values()) {
      if (r.a === k.id || r.b === k.id) {
        r.war = false;
        r.ally = false;
      }
    }
    for (const a of this.armies) if (a.kingdom === k.id) this._disbandArmy(a);
    const cap = this.villages[k.capital];
    this._note(`${k.name} has fallen`, 'bad', cap ? { x: cap.cx, z: cap.cz } : null);
    this.colorVersion++;
  },

  // ---------------------------------------------------------------- diplomacy
  _diplomacy() {
    this._secession();
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
        r.opinion += (target - r.opinion) * 0.12;
        r.opinion = clamp(r.opinion, -100, 100);
        r.grievance = Math.max(0, r.grievance - 0.25);

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
        for (const [att, def] of [
          [A, B],
          [B, A],
        ]) {
          if (now - att.founded < YEAR * 6 || now - def.founded < YEAR * 5) continue;
          if (this.warCount(att.id) >= 2) continue;
          const ratio = att.strength / Math.max(1, def.strength);
          const crowd = this._crowd?.() || 0;
          const hostile = r.opinion < -30 + crowd * 25;
          const ambitious = att.ambition > 0.55 && ratio > 1.6 && r.opinion < 0;
          // land hunger: a capped world with a weaker neighbour on the border
          const hungry = border > 6 && ratio > 1.3 && now - att.lastWar > YEAR * 8 && r.opinion < 30 && crowd > 0.5;
          if (!hostile && !ambitious && !hungry) continue;
          if (ratio < 0.6) continue;
          let p = 0.03 + att.aggression * 0.08 + (ambitious ? 0.05 : 0) + (hungry ? 0.04 + crowd * 0.05 : 0);
          p *= this.law('diploWarlike', 1) * (g.age?.mods?.warlike ?? 1);
          if (this._rulerTrait(att, 'cruel', 'valiant')) p *= 1.6;
          if (this._rulerTrait(att, 'gentle', 'silver-tongued', 'silvertongued')) p *= 0.55;
          if (this.hasCultureTrait(att.culture, 'Martial')) p *= 1.3;
          if (!rng.chance(p)) continue;
          let reason;
          if ((ambitious && ratio > 1.6 && att.ambition > 0.7) || (hungry && !hostile)) reason = 'ambition';
          else if (border > 12) reason = 'border';
          else if (att.culture !== def.culture) reason = 'culture';
          else reason = 'border';
          this.declareWar(att.id, def.id, reason);
          break;
        }
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
        const d = Math.hypot(a.cx - b.cx, a.cz - b.cz);
        if (d < best) best = d;
      }
    }
    return best;
  },

  _kingdomPos(k) {
    const v = this.villages[k.capital];
    return v ? { x: v.cx, z: v.cz } : null;
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
    if (ra) this.game.units.log?.(ra, `Declared war on ${this._kn(B)}`);
    if (rb) this.game.units.log?.(rb, `${this._kn(A)} declared war on us`);
    const pb = this._kingdomPos(B);
    this._sfx('war-horn', pb?.x ?? 0, pb?.z ?? 0, 0, true);
    // allies of the defender may join
    if (reason !== 'alliance') {
      for (const k of this.kingdoms) {
        if (!k.alive || k.id === a || k.id === b) continue;
        if (this.allied(k.id, b) && !this.allied(k.id, a) && this.warCount(k.id) < 2 && this.rng.chance(0.7)) {
          const rr = this.rel(k.id, a);
          if (!rr.war) {
            rr.war = true;
            rr.ally = false;
            rr.warSince = this.game.time.total;
            rr.reason = 'alliance';
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
    if (weary > 0.22 && dur > YEAR * 2) return this.makePeace(A.id, B.id);
    if (dur < YEAR * 3) return;
    // without diplomacy, wars end only in exhaustion
    if (!this.law('civDiplomacy')) return;
    const lossA = r.startPop[r.a === A.id ? 0 : 1] - A.population;
    const lossB = r.startPop[r.a === A.id ? 1 : 0] - B.population;
    const popWeary = Math.max(lossA / Math.max(1, r.startPop[0]), lossB / Math.max(1, r.startPop[1]));
    let p = 0.02 + Math.max(0, popWeary) * 0.25 + weary * 0.5 + Math.max(0, dur - YEAR * 8) / (YEAR * 100);
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
            const d = Math.hypot(ev.cx - v.cx, ev.cz - v.cz);
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
      if (Math.hypot(v.cx - home.cx, v.cz - home.cz) > 70) continue;
      const own = [...v.members].filter((u) => u.alive && u.job === 'soldier' && !u.data.civ?.army);
      const keep = v === home ? 1 : 1;
      for (let i = keep; i < own.length; i++) soldiers.push(own[i]);
    }
    k.lastArmy = this.game.time.total;
    if (soldiers.length > 18) soldiers.length = 18;
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
    this.armies.push(army);
    return army;
  },

  _disbandArmy(a) {
    for (const u of a.units) if (u.data?.civ) u.data.civ.army = null;
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
          if (!ev?.alive || ev.landId !== this.villages[a.home]?.landId) continue;
          const d = Math.hypot(ev.cx - c.x, ev.cz - c.z);
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
      }
      if (now - a.t > 240) this._disbandArmy(a);
    } else if (a.state === 'siege') {
      // capture once the hall is broken and defenders are gone
      const hall = target.hall;
      const defenders = this.game.units.query(target.cx, target.cz, target.radius * 0.8, (o) => o.kingdom === target.kingdom && o.job === 'soldier' && o.species === 'human');
      const hallDown = !hall || !hall.alive || hall.hp < hall.maxHp * 0.35;
      if (hallDown && defenders.length === 0) this._capture(a, target);
      else if (now - a.t > 200) this._disbandArmy(a);
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
    const raze = K.culture !== old.culture && K.aggression > 0.7 && this.rng.chance(0.35) && v.id !== old.capital;
    const r = this.rel(K.id, old.id);
    r.grievance = Math.min(80, r.grievance + 25);
    if (raze) {
      this._note(`🔥 ${this._kn(K)} burns ${v.name}`, 'disaster', { x: v.cx, z: v.cz });
      for (const b of v.buildings) if (b.alive) b.burning = Math.max(b.burning, 0.7 + this.rng.next() * 0.3);
      v.razed = true;
      for (const u of [...v.members]) if (u.job !== 'soldier') this._makeRefugee(u, old);
    } else {
      this.transferVillage(v, K.id, 'conquest');
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
      const d = Math.hypot(v.cx - u.x, v.cz - u.z);
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    if (best) this._moveMember(u, best);
    else this._removeMember(u);
  },

  // Change a village's allegiance (conquest, rebellion, gift).
  transferVillage(v, kid, cause = 'conquest') {
    const old = this.kingdoms[v.kingdom];
    const K = this.kingdoms[kid];
    if (!K) return;
    if (old) {
      old.villages = old.villages.filter((id) => id !== v.id);
    }
    v.kingdom = kid;
    K.villages.push(v.id);
    v.conqueredAt = this.game.time.total;
    v.loyalty = cause === 'rebellion' ? 80 : 35;
    for (const b of v.buildings) b.kingdom = kid;
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
      if (rk) this.game.units.log?.(rk, `Conquered ${v.name}`);
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
        this._killKingdom(old, cause);
      } else if (old.capital === v.id) {
        const nc = this._chooseCapital(old);
        if (nc) this._note(`${this._kn(old)} moves its capital to ${nc.name}`, 'info', { x: nc.cx, z: nc.cz });
        const ru = this.game.units.byId.get(old.ruler);
        if (!ru || !ru.alive || ru.kingdom !== old.id) this._succession(old, old.rulerName || 'The ruler');
      }
    }
    if (K.capital < 0 || !this.villages[K.capital]?.alive) this._chooseCapital(K);
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
    if (cap) L -= Math.max(0, Math.hypot(cap.cx - v.cx, cap.cz - v.cz) - 28) * 0.75;
    if (v.culture !== k.culture) L -= 18;
    if (v.conqueredAt) L -= Math.max(0, 34 - ((now - v.conqueredAt) / YEAR) * 3);
    if (v.starving && this.law('harmonyUnrest')) L -= 22;
    if (this.warCount(k.id) > 0 && this.law('harmonyUnrest')) L -= 6;
    if (now < k.interregnumUntil) L -= 18;
    if (now < k.goldenUntil) L += 30;
    if (v.buildings.some((b) => b.alive && b.type === 'temple' && !b.constructing)) L += 8;
    if (v.tier >= 1 && cap && v.pop > cap.pop * 0.8) L -= 14; // rival city
    if (v.tier >= 2) L -= 6; // proud cities chafe under distant rule
    if (k.villages.length > 3) L -= (k.villages.length - 3) * 4.5; // overstretched realm
    // a crowded, capped world turns ambition inward: provinces want their own crown
    L -= (this._crowd?.() || 0) * 12;
    if (alive < 3) L -= 14; // a world of two empires is a powder keg
    if (alive >= 7) L += 12;
    if (this.law('harmonyUnrest') && v.famineT && now - v.famineT < YEAR * 4) L -= 10;
    L += (this.law('harmonyLoyalty', 1) * (this.game.age?.mods?.harmony ?? 1) - 1) * 35;
    L += this.techAdd(k.id, 'loyalty');
    if (this.hasCultureTrait(v.culture, 'Mystic')) L += 5;
    L += (v.loyaltyBoost || 0);
    v.loyaltyBoost = Math.max(0, (v.loyaltyBoost || 0) - 1);
    v.loyalty = clamp(v.loyalty + (L - v.loyalty) * 0.2, 0, 100);
    if (v.loyalty < 32 && v.pop >= 8) v.unrest = (v.unrest || 0) + 1;
    else v.unrest = Math.max(0, (v.unrest || 0) - 1);
    if (v.unrest >= 3 && this.law('civRebellions') && this.rng.chance(alive < 3 ? 0.3 : 0.14)) this.rebel(v);
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
    if (!bestK) return;
    const p = (alive < 3 ? 0.35 : 0.08) + (this._crowd?.() || 0) * 0.15 + (bestK.villages.length - 4) * 0.05;
    if (!this.rng.chance(p)) return;
    const cap = this.villages[bestK.capital];
    let far = null,
      fd = -1;
    for (const vid of bestK.villages) {
      const v = this.villages[vid];
      if (!v?.alive || vid === bestK.capital || v.pop < 8) continue;
      const d = cap ? Math.hypot(cap.cx - v.cx, cap.cz - v.cz) : 0;
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
      this._note(`👑 ${far.name} secedes peacefully from ${this._kn(old)} as the ${K.name}`, 'info', { x: far.cx, z: far.cz });
    } else this._note(`✊ ${far.name} breaks away from ${this._kn(old)}: the ${K.name}`, 'war', { x: far.cx, z: far.cz });
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
  rebel(v, silent = false) {
    const old = this.kingdoms[v.kingdom];
    if (!old || old.capital === v.id) return null;
    const K = this.createKingdom(v.culture, { baseName: v.name, parent: old.id, x: v.cx, z: v.cz });
    const oldName = old.base || old.name;
    this.transferVillage(v, K.id, 'rebellion');
    K.capital = v.id;
    v.unrest = 0;
    // pick a leader
    let leader = null;
    for (const u of v.members) if (u.alive && u.age >= ADULT_AGE + 2 && (!leader || (u.job === 'soldier') > (leader.job === 'soldier') || u.age > leader.age)) leader = u;
    if (leader) this.crown(K, leader);
    if (!silent) this._note(`✊ ${v.name} rebels against ${oldName}: the ${K.name}`, 'war', { x: v.cx, z: v.cz });
    // discontented neighbours join
    for (const vid of [...old.villages]) {
      const o = this.villages[vid];
      if (!o?.alive || o.id === old.capital) continue;
      if (Math.hypot(o.cx - v.cx, o.cz - v.cz) < 34 && o.loyalty < 40 && this.rng.chance(0.6)) {
        this.transferVillage(o, K.id, 'rebellion');
        this._note(`${o.name} joins the rebels`, 'war', { x: o.cx, z: o.cz }, 'joinreb' + K.id, 60);
      }
    }
    if (old.alive) this.declareWar(K.id, old.id, 'rebellion', true);
    return K;
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
