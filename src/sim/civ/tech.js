import { YEAR } from './util.js';

// Eras and technology. Each kingdom accumulates knowledge (population,
// temples, libraries, observatories, wise rulers, Scholarly culture), scaled
// by the civTechSpeed law and the age's techRate, and researches one
// technology at a time, choosing by its culture's leanings. Two technologies
// of an era carry the kingdom into it, which shows in its architecture.
//
// API (on game.civ): hasTech(kingdomId, techId), kingdomEra(kingdomId),
//   ERAS, TECHS, techById, kingdom fields {knowledge, techs:Set, era, researching}.

export const ERAS = [
  { id: 0, name: 'Hearth', description: 'Thatch, timber and the first fields.' },
  { id: 1, name: 'Bronze', description: 'Stone footings, fired tile and bronze blades.' },
  { id: 2, name: 'Iron', description: 'Slate, stone towers and iron arms.' },
  { id: 3, name: 'Enlightened', description: 'Dressed stone, glass windows and learning.' },
];

export const TECHS = [
  // Hearth
  { id: 'agriculture', name: 'Agriculture', era: 0, cost: 60, requires: [], description: 'Ploughs and seed-saving: richer harvests.', effects: { harvest: 1.15 } },
  { id: 'masonry', name: 'Masonry', era: 0, cost: 70, requires: [], description: 'Cut stone for footings and walls.', effects: { stone: 1.2 } },
  { id: 'pottery', name: 'Pottery', era: 0, cost: 60, requires: [], description: 'Fired jars keep grain longer.', effects: { foodCap: 1.25 } },
  { id: 'fishing', name: 'Fishing', era: 0, cost: 55, requires: [], description: 'Nets and weirs fill the larder.', effects: { fish: 1.3 } },
  // Bronze
  { id: 'bronzeworking', name: 'Bronzeworking', era: 1, cost: 210, requires: ['masonry'], description: 'Bronze tools and blades.', effects: { material: 'bronze', work: 1.08 } },
  { id: 'sailing', name: 'Sailing', era: 1, cost: 200, requires: ['fishing'], description: 'Harbours and sea-going ships.', effects: { fish: 1.2 }, unlocks: ['harbour'] },
  { id: 'writing', name: 'Writing', era: 1, cost: 220, requires: ['pottery'], description: 'Scribes and libraries.', effects: { research: 1.15 }, unlocks: ['library'] },
  { id: 'irrigation', name: 'Irrigation', era: 1, cost: 190, requires: ['agriculture'], description: 'Channels water the fields.', effects: { harvest: 1.15 } },
  { id: 'horsemanship', name: 'Horsemanship', era: 1, cost: 180, requires: ['agriculture'], description: 'Riders carry news and armies further.', effects: { march: 1.15 } },
  // Iron
  { id: 'ironworking', name: 'Ironworking', era: 2, cost: 520, requires: ['bronzeworking'], description: 'Iron arms and armour.', effects: { material: 'iron', work: 1.08 } },
  { id: 'fortification', name: 'Fortification', era: 2, cost: 480, requires: ['masonry', 'bronzeworking'], description: 'Curtain walls, gates and towers.', effects: { walls: true }, unlocks: ['walls'] },
  { id: 'medicine', name: 'Medicine', era: 2, cost: 460, requires: ['writing'], description: 'Healers: more children live to grow up.', effects: { birth: 1.2 } },
  { id: 'mathematics', name: 'Mathematics', era: 2, cost: 470, requires: ['writing'], description: 'Numbers speed every inquiry.', effects: { research: 1.15 } },
  { id: 'architecture', name: 'Architecture', era: 2, cost: 500, requires: ['masonry', 'mathematics'], description: 'Arches, aqueducts and grand halls.', effects: { build: 1.15 }, unlocks: ['aqueduct'] },
  // Enlightened
  { id: 'steelworking', name: 'Steelworking', era: 3, cost: 1000, requires: ['ironworking'], description: 'Steel: the finest blades.', effects: { material: 'steel' } },
  { id: 'philosophy', name: 'Philosophy', era: 3, cost: 900, requires: ['mathematics', 'medicine'], description: 'Wise laws keep provinces loyal.', effects: { loyalty: 12 } },
  { id: 'banking', name: 'Banking', era: 3, cost: 940, requires: ['mathematics'], description: 'Coin works harder: markets prosper.', effects: { gold: 1.5 } },
  { id: 'engineering', name: 'Engineering', era: 3, cost: 960, requires: ['architecture'], description: 'Cranes and mills: faster building.', effects: { build: 1.25 } },
  { id: 'astronomy', name: 'Astronomy', era: 3, cost: 920, requires: ['mathematics', 'sailing'], description: 'Star charts and observatories.', effects: { research: 1.1 }, unlocks: ['observatory'] },
];

export const techById = Object.fromEntries(TECHS.map((t) => [t.id, t]));

// Research leanings of culture traits.
const LEANINGS = {
  Seafaring: ['fishing', 'sailing', 'astronomy'],
  Martial: ['bronzeworking', 'horsemanship', 'ironworking', 'fortification', 'steelworking'],
  Scholarly: ['writing', 'mathematics', 'philosophy', 'astronomy'],
  Pastoral: ['agriculture', 'irrigation', 'medicine'],
  Mystic: ['pottery', 'medicine', 'philosophy', 'astronomy'],
  Mercantile: ['pottery', 'sailing', 'banking'],
  Masons: ['masonry', 'architecture', 'engineering', 'fortification'],
  Wanderers: ['horsemanship', 'fishing', 'agriculture'],
};

export const tech = {
  hasTech(kid, techId) {
    const k = this.kingdoms[kid];
    return !!(k && k.techs && k.techs.has(techId));
  },
  kingdomEra(kid) {
    return this.kingdoms[kid]?.era ?? 0;
  },
  eraName(kid) {
    return ERAS[this.kingdomEra(kid)]?.name || 'Hearth';
  },
  // Combined multiplier of a technology effect across a kingdom's learning.
  techMod(kid, key) {
    const k = this.kingdoms[kid];
    if (!k?.techs) return 1;
    let m = key === 'work' || key === 'harvest' || key === 'build' ? 1 + Math.min(0.5, (k.mastery || 0) * 0.03) : 1;
    for (const id of k.techs) {
      const e = techById[id]?.effects;
      if (e && typeof e[key] === 'number') m *= e[key];
    }
    if (k.wonderFx?.[key]) m *= k.wonderFx[key];
    return m;
  },
  techAdd(kid, key) {
    const k = this.kingdoms[kid];
    if (!k?.techs) return 0;
    let a = 0;
    for (const id of k.techs) {
      const e = techById[id]?.effects;
      if (e && typeof e[key] === 'number') a += e[key];
    }
    if (k.wonderFx?.[key + '+']) a += k.wonderFx[key + '+'];
    return a;
  },
  // Best weapon/armour material the kingdom can forge.
  bestMaterial(kid) {
    if (this.hasTech(kid, 'steelworking')) return 'steel';
    if (this.hasTech(kid, 'ironworking')) return 'iron';
    if (this.hasTech(kid, 'bronzeworking')) return 'bronze';
    return this.hasTech(kid, 'masonry') ? 'stone' : 'wood';
  },

  masteryCost(k) {
    return Math.round(1400 * Math.pow(1.35, k.mastery || 0));
  },
  researchLabel(k) {
    if (!k?.researching) return null;
    if (k.researching === 'mastery') return { name: `Mastery ${(k.mastery || 0) + 1}`, cost: this.masteryCost(k) };
    const t = techById[k.researching];
    return t ? { name: t.name, cost: t.cost } : null;
  },

  _initTech(k) {
    k.knowledge = 0;
    k.techs = k.techs instanceof Set ? k.techs : new Set();
    k.era = k.era || 0;
    k.researching = null;
  },

  _availableTechs(k) {
    const known = k.techs;
    const inEra = (e) => TECHS.filter((t) => t.era === e && known.has(t.id)).length;
    const maxEra = Math.min(3, k.era + (inEra(k.era) >= 3 || (k.era > 0 && inEra(k.era) >= 2) ? 1 : 0));
    return TECHS.filter((t) => !known.has(t.id) && t.era <= maxEra && t.requires.every((r) => known.has(r)));
  },

  _chooseResearch(k) {
    const opts = this._availableTechs(k);
    if (!opts.length) return null;
    const traits = this.cultureDef(k.culture)?.traits || [];
    let best = null,
      bs = -Infinity;
    for (const t of opts) {
      let s = -t.cost / 100 + this.rng.next() * 1.5;
      for (const tr of traits) if (LEANINGS[tr]?.includes(t.id)) s += 2.5;
      if (t.era < k.era) s += 1; // catch up on the basics first
      if (s > bs) {
        bs = s;
        best = t;
      }
    }
    return best.id;
  },

  // Called every 2 s.
  _researchTick(dt) {
    if (!this.law('civTechnology')) return;
    const g = this.game;
    const speed = this.law('civTechSpeed', 1) * (g.age?.mods?.techRate ?? 1);
    for (const k of this.kingdoms) {
      if (!k.alive || !k.villages.length) continue;
      if (!k.techs) this._initTech(k);
      let pop = 0,
        temples = 0,
        libraries = 0,
        observatories = 0;
      for (const vid of k.villages) {
        const v = this.villages[vid];
        if (!v?.alive) continue;
        pop += v.pop;
        for (const b of v.buildings) {
          if (!b.alive || b.constructing) continue;
          if (b.type === 'temple') temples += b.level;
          else if (b.type === 'library') libraries++;
          else if (b.type === 'observatory') observatories++;
        }
      }
      let rate = 0.2 + pop * 0.011 + temples * 0.3 + libraries * 0.9 + observatories * 1.4;
      rate *= this.techMod(k.id, 'research');
      const traits = this.cultureDef(k.culture)?.traits || [];
      if (traits.includes('Scholarly')) rate *= 1.35;
      if (traits.includes('Mystic')) rate *= 1.1;
      const ruler = g.units.byId.get(k.ruler);
      if (ruler && (g.units.hasTrait?.(ruler, 'sage') || g.units.hasTrait?.(ruler, 'inventive'))) rate *= 1.3;
      if (ruler) rate *= g.units.traitMod?.(ruler, 'research') ?? 1;
      // scholars: learned folk in the libraries' towns add their wit
      if (libraries && g.units.traitMod) {
        let wit = 0,
          n = 0;
        for (const vid of k.villages) {
          const v = this.villages[vid];
          if (!v?.alive || !v.buildings.some((b) => b.type === 'library' && b.alive)) continue;
          for (const u of v.members) {
            if (n > 40) break;
            const r = g.units.traitMod(u, 'research');
            if (r !== 1) wit += r - 1;
            n++;
          }
        }
        rate *= 1 + Math.max(-0.3, Math.min(0.6, wit * 0.15));
      }
      if (g.time.total < k.goldenUntil) rate *= 1.3;
      k.knowledge += rate * speed * dt;
      if (!k.researching || k.techs.has(k.researching)) k.researching = this._chooseResearch(k) || 'mastery';
      if (k.researching === 'mastery') {
        // every discovery made: refine the arts, one Mastery at a time
        const cost = this.masteryCost(k);
        if (k.knowledge >= cost) {
          k.knowledge -= cost;
          k.mastery = (k.mastery || 0) + 1;
          this._history(`📜 ${this._kn(k)} attains Mastery ${k.mastery}`, 'info', this._kingdomPos(k));
          if (k.mastery % 3 === 0) this._note(`📜 ${this._kn(k)} attains Mastery ${k.mastery}`, 'good', this._kingdomPos(k), 'mastery' + k.id, 1);
          k.researching = null;
        }
        continue;
      }
      const t = techById[k.researching];
      if (t && k.knowledge >= t.cost) {
        k.knowledge -= t.cost;
        this.learnTech(k, t.id);
      }
    }
  },

  learnTech(k, id, silent = false) {
    if (k.techs.has(id)) return;
    k.techs.add(id);
    k.researching = null;
    const t = techById[id];
    const first = !this._techFirst.has(id);
    this._techFirst.add(id);
    this._history(`📜 ${this._kn(k)} learns ${t.name}`, 'info', this._kingdomPos(k));
    if (first && !silent) this._note(`📜 ${this._kn(k)} is first to master ${t.name}`, 'good', this._kingdomPos(k), 'tech' + id, 1);
    // era advance: two technologies of the next era
    const inEra = (e) => TECHS.filter((x) => x.era === e && k.techs.has(x.id)).length;
    while (k.era < 3 && inEra(k.era + 1) >= 2) {
      k.era++;
      if (!silent) this._note(`🏛 ${this._kn(k)} enters the ${ERAS[k.era].name} Era`, 'good', this._kingdomPos(k), 'era' + k.id + k.era, 1);
      this.version++;
    }
    this.colorVersion++;
  },
};

export { LEANINGS, YEAR as TECH_YEAR };
