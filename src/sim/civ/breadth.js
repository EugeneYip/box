import { TILE, FLORA, FLORA_INFO, SEA_LEVEL } from '../../world/constants.js';
import { BUILDING_TYPES } from './catalog.js';
import { USE, YEAR, ADULT_AGE, clamp } from './util.js';
import { FOOTPRINT } from '../../core/scale.js';
import { baseCulture } from './cultures.js';

// tinned food relief (_tinnedFood): the wait after want begins, the time
// between shipments (game seconds; a year is 30) and the most one shipment
// carries, in meals per head
const RELIEF_WAIT = 30,
  RELIEF_EVERY = 15,
  RELIEF_SHARE = 1.2;
// the cannery's own shipment when no sister town has plenty: at least
// RELIEF_MIN meals, else RELIEF_OWN meals a head (round 29)
const RELIEF_MIN = 3,
  RELIEF_OWN = 0.3;

// Technology breadth (docs/TECH-BREADTH.md, the parts owned by Civ): the
// buildings of the food, medicine, biome, city-development and urban-planning
// branches and of Planetary Defense, where the planner puts them, and the
// counter each gives against a danger of the world. The disasters read the
// guards below; urban renewal and heritage live in renewal.js.
//
// PUBLIC CONTRACT (additions to game.civ)
//   guardOf(village, danger) -> 0..1   how well a town is protected against
//       'fire' | 'quake' | 'flood' | 'storm' | 'meteor'
//   guardAt(x, z, danger) -> 0..1       the same for the town at a point (or 0)
//   fireGuard {data: Uint8Array, cw, ch, cell}  coarse grid (0..255) FireSim reads
//   shelterAt(x, z, cause) -> 0..1      share of a disaster's harm to people
//       that still lands there (forecasting shelters, seismic frames, levees)
//   skyShieldAt(x, z) -> bool           a falling meteor here is broken up
//   plagueResist(u), plagueCatch(target, source), plagueCure(u)  (Plague.js)
//   losses {kingdom id -> {fire, quake, flood, tsunami, tornado, meteor,
//       plague, famine, ...}}  buildings lost and people dead, by cause
// Kingdom fields: stormWarnUntil (game seconds; Fleets keeps ships in port and
//   aircraft down while it lasts), dangers (recent losses, steering research).
// Village fields: guard {fire, quake, flood, storm, meteor}, spoil, winterNeed,
//   farmEase (tractors: fewer farmers), dry, cold, renewed.
// Unit fields: data.role 'firefighter' | 'doctor' | 'forester' | 'police' |
//   'scientist' | 'astronaut' (drawn and given behavior by Life).
// Building fields: quarantine (game seconds: a plague flag flies), heritage.
// Events: 'civ:alarm' {kind: 'fire'|'storm'|'meteor', x, z, village, kingdom}
//   (Fleets sends fire engines and rescue craft to fires and disasters).

// "The Kingdom of X ..." — the first time a realm uses a breadth unlock
export const BREADTH_FIRST = {
  pasture: 'pens its first herds in pastures beside the fields',
  rotation: 'leaves its first fields fallow in rotation',
  smokehouse: 'smokes and salts its first stores against the winter',
  cannery: 'opens its first cannery',
  tinned: 'sends tinned food to a starving town',
  silo: 'raises its first grain silos: tractors work the fields',
  greenhouse: 'glazes its first greenhouses',
  vertfarm: 'opens its first vertical farm',
  lazaretto: 'opens a lazaretto outside its town',
  quarantine: 'flies plague flags over its sick houses',
  clinic: 'opens its first clinic',
  hospital: 'opens its first hospital',
  genelab: 'opens a research hospital',
  meddrone: 'sends medical drones over its towns',
  terrace: 'cuts its first terraced fields into the hills',
  qanat: 'digs its first qanat in the dry land',
  desertfarm: 'brings its fields to the desert',
  coldfarm: 'brings its fields to the snows',
  nursery: 'plants its first tree nursery',
  replant: 'replants a felled wood',
  levee: 'raises its first levees against the floods',
  weatherstation: 'opens its first weather station',
  stormwarn: 'warns its towns of a coming storm: the people take shelter',
  desal: 'opens its first desalination plant',
  climatetower: 'raises its first climate tower: the barren land begins to green',
  greening: 'turns barren land green around a city',
  firestation: 'opens its first fire station',
  brigade: 'puts out a town fire with its fire brigade',
  hydrant: 'lays fire walls and hydrants in its towns',
  fireengine: 'sends fire engines racing to a fire',
  seismic: 'braces its towers against earthquakes',
  controlspire: 'raises its first control spire',
  gridstreets: 'lays out a new quarter in grid streets',
  zoning: 'divides its towns into districts of homes, industry and markets',
  transit: 'runs its first trams and buses',
  park: 'opens its first city park',
  skyshield: 'opens a planetary defense station',
  meteorstop: 'breaks up a falling meteor in the sky above its town',
  firefighter: 'trains its first firefighters',
  doctor: 'sends doctors on their rounds',
  forester: 'sends foresters into the woods',
  police: 'puts police on its streets',
  scientist: 'staffs its campus with scientists',
  astronaut: 'trains its first astronauts',
  renewal: 'rebuilds an old quarter denser',
  ringroad: 'takes down its old walls for a ring road',
  heritage: 'protects its old buildings as heritage',
};

const DANGERS = ['fire', 'quake', 'flood', 'storm', 'meteor'];
const CELL = 4; // tiles per fire-guard cell
const ROLE_SET = new Set(['firefighter', 'doctor', 'forester', 'police', 'scientist', 'astronaut']);
// how much each building cause counts as a danger a realm remembers
const CAUSE_DANGER = { fire: 'fire', lava: 'fire', lightning: 'fire', earthquake: 'quake', quake: 'quake', flood: 'flood', tsunami: 'flood', tornado: 'storm', meteor: 'meteor' };

export const breadth = {
  // ------------------------------------------------------------ queries
  guardOf(v, danger) {
    return v?.guard?.[danger] || 0;
  },
  // the town whose ground a point lies on (within its radius plus a margin)
  _townAt(x, z, pad = 3) {
    let best = null,
      bd = Infinity;
    for (const v of this.villages) {
      if (!v.alive) continue;
      const d = Math.hypot(v.cx - x, v.cz - z);
      if (d < (v.radius || 8) + pad && d < bd) (bd = d), (best = v);
    }
    return best;
  },
  guardAt(x, z, danger) {
    return this.guardOf(this._townAt(x, z), danger);
  },
  // Share of a disaster's harm to people that still lands at a point.
  shelterAt(x, z, cause) {
    const v = this._townAt(x, z, 4);
    if (!v?.guard) return 1;
    const G = v.guard;
    if (cause === 'earthquake' || cause === 'quake') return 1 - 0.7 * G.quake;
    if (cause === 'tsunami' || cause === 'flood') return 1 - 0.75 * Math.max(G.flood, G.storm);
    if (cause === 'tornado' || cause === 'storm' || cause === 'lightning') return 1 - 0.75 * G.storm;
    if (cause === 'meteor') return G.meteor ? 0.3 : 1 - 0.4 * G.storm;
    if (cause === 'fire') return 1 - 0.6 * G.fire;
    return 1;
  },
  // Planetary Defense: a protected town's sky (World Law civSkyShield).
  skyShieldAt(x, z) {
    if (!this.law('civSkyShield', true)) return false;
    const v = this._townAt(x, z, 10);
    return !!v?.guard?.meteor;
  },
  // A falling meteor broken up over a town (Meteor.js).
  meteorStopped(x, z) {
    const v = this._townAt(x, z, 10);
    const k = v ? this.kingdoms[v.kingdom] : null;
    if (!k) return;
    this._loss(k, 'meteorStopped', 1);
    this._firstUse(k, 'meteorstop', { x, z });
    this.game.events.emit('civ:alarm', { kind: 'meteor', x, z, village: v.id, kingdom: k.id });
  },
  // Plague: how hard it bites the sick (physicians, sewers, hospitals, nanomedicine).
  plagueResist(u) {
    const v = this.villages[u?.village];
    if (!v?.alive) return 1;
    const kid = v.kingdom;
    let f = 1;
    if (this.hasTech(kid, 'medicine')) f = 0.85;
    if (this.hasTech(kid, 'sanitation')) f = 0.45;
    if (v.hasWaterworks) f = 0.3;
    if (this.hasTech(kid, 'antibiotics')) f *= v.med?.hospital ? 0.3 : 0.5;
    if (this.hasTech(kid, 'nanomed')) f *= 0.3;
    return f;
  },
  // ... how readily the healthy catch it from the sick nearby
  plagueCatch(o, src) {
    const v = this.villages[o?.village];
    let f = 1;
    if (v?.alive) {
      const kid = v.kingdom;
      if (this.hasTech(kid, 'vaccination')) f *= v.med?.clinic ? 0.3 : 0.45;
      if (this.hasTech(kid, 'nanomed')) f *= 0.3;
    }
    // Quarantine: the sick are kept within their own town
    if (src && o && src.village !== o.village) {
      const sv = this.villages[src.village];
      if ((sv?.alive && this.hasTech(sv.kingdom, 'quarantine')) || (v?.alive && this.hasTech(v.kingdom, 'quarantine'))) f *= 0.1;
    }
    return f;
  },
  // ... and how soon the sick recover
  plagueCure(u) {
    const v = this.villages[u?.village];
    if (!v?.alive) return 1;
    let f = 1;
    if (this.hasTech(v.kingdom, 'antibiotics')) f *= v.med?.hospital ? 4 : 2.5;
    if (this.hasTech(v.kingdom, 'nanomed')) f *= 2;
    return f;
  },
  // Building damage that still lands, by cause (Civilization.damageArea).
  _bGuard(b, cause) {
    const v = this.villages[b.village];
    const G = v?.guard;
    if (!G) return 1;
    if (cause === 'earthquake' || cause === 'quake') return 1 - 0.85 * G.quake;
    if (cause === 'tsunami' || cause === 'flood') return 1 - 0.75 * G.flood;
    if (cause === 'tornado') return 1 - 0.25 * G.storm - (this.hasTech(v.kingdom, 'buildcodes') ? 0.15 : 0);
    if (cause === 'fire') return 1 - 0.5 * G.fire;
    return 1;
  },

  // ------------------------------------------------------------ bookkeeping
  _loss(k, key, n) {
    if (!k) return;
    const L = this.losses || (this.losses = {});
    const r = L[k.id] || (L[k.id] = {});
    r[key] = (r[key] || 0) + n;
  },
  // a building lost (Civilization.destroyBuilding)
  _lossNote(b, cause) {
    const k = this.kingdoms[b.kingdom];
    if (!k || BUILDING_TYPES[b.type]?.wall) return;
    const key = cause === 'lava' || cause === 'lightning' ? 'fire' : cause;
    if (!CAUSE_DANGER[key]) return;
    this._loss(k, key, 1);
    const D = k.dangers || (k.dangers = {});
    const d = CAUSE_DANGER[key];
    D[d] = Math.min(6, (D[d] || 0) + 0.5);
  },
  // a person lost (Civilization._onDeath)
  _deathNote(u, cause) {
    const k = this.kingdoms[u.kingdom];
    if (!k) return;
    const key = cause === 'starvation' ? 'famine' : cause;
    if (!['plague', 'famine', 'earthquake', 'tsunami', 'tornado', 'meteor', 'fire', 'flood', 'lava'].includes(key)) return;
    this._loss(k, 'dead_' + key, 1);
    const D = k.dangers || (k.dangers = {});
    const d = key === 'famine' ? 'famine' : key === 'plague' ? 'plague' : CAUSE_DANGER[key];
    if (d) D[d] = Math.min(6, (D[d] || 0) + 0.25);
  },

  // ------------------------------------------------------------ land (planner hooks)
  // May a village till this tile? (planner._fieldTypeOK, after its own rules)
  _fieldBiomeOK(v, t) {
    const kid = v.kingdom;
    if (t === TILE.DESERT || t === TILE.SAND) return this.hasTech(kid, 'qanats') || this.hasTech(kid, 'hybridcrops') || (t === TILE.SAND && v.coastal && this.hasTech(kid, 'desalination'));
    if (t === TILE.SNOW) return this.hasTech(kid, 'coldbuild');
    return false;
  },
  // the steepest plot (height range) a village may till: Terracing climbs the hills
  _terraceSlope(v) {
    return this.hasTech(v.kingdom, 'terracing') ? 2.4 : 1.0;
  },
  // fertility of each tile type for a realm's settlers (planner._scoreSite)
  _fertTable(kid, base) {
    if (kid == null || !this.kingdoms[kid]?.techs) return base;
    const q = this.hasTech(kid, 'qanats'),
      c = this.hasTech(kid, 'coldbuild'),
      h = this.hasTech(kid, 'hybridcrops');
    if (!q && !c && !h) return base;
    const t = base.slice();
    if (q || h) {
      t[TILE.DESERT] = Math.max(t[TILE.DESERT], h ? 0.7 : 0.5);
      t[TILE.SAVANNA] = Math.max(t[TILE.SAVANNA], 0.8);
    }
    if (c) {
      t[TILE.SNOW] = Math.max(t[TILE.SNOW], 0.45);
      t[TILE.TUNDRA] = Math.max(t[TILE.TUNDRA], 0.7);
    }
    return t;
  },
  // a new plot was laid out: on land only a skill could open
  _plotBiome(v, plot, slope) {
    const k = this.kingdoms[v.kingdom];
    if (!k) return;
    const w = this.world;
    let dry = 0,
      snow = 0;
    for (const i of plot.tiles) {
      const t = w.type[i];
      if (t === TILE.DESERT || t === TILE.SAND) dry++;
      else if (t === TILE.SNOW) snow++;
    }
    const pos = { x: (plot.x0 + plot.x1) / 2, z: (plot.y0 + plot.y1) / 2 };
    const n = plot.tiles.length;
    if (slope > 1.0) {
      plot.terraced = true;
      this._loss(k, 'land_terrace', 1);
      this._firstUse(k, 'terrace', pos);
    }
    if (dry * 2 > n && baseCulture(v.culture) !== 'dune') {
      plot.biome = 'desert';
      this._loss(k, 'land_desert', 1);
      this._firstUse(k, 'desertfarm', pos);
    } else if (snow * 2 > n && baseCulture(v.culture) !== 'frost') {
      plot.biome = 'snow';
      this._loss(k, 'land_snow', 1);
      this._firstUse(k, 'coldfarm', pos);
    }
  },
  // Town Planning: streets branch off a straight run every few tiles (grid blocks)
  _gridPlan(v) {
    return this.hasTech(v.kingdom, 'townplan');
  },

  // ------------------------------------------------------------ building plan
  // Called from _planModern (modern.js) with the planner's helpers.
  _planBreadth(v, K, room, build, upgrade, count) {
    if (!K?.techs || !this._anyBreadth(K)) return;
    const has = (t) => K.techs.has(t);
    const pop = v.pop;
    const town = v.tier >= 1;
    const city = v.tier >= 2;
    const isCap = K.capital === v.id;
    if ((v.houses || 0) < 3 && !town) return;
    const realm = this._breadthRealm(K);
    const rc = (t) => realm.get(t) || 0;
    const now = this.game.time.total;
    const fail = v.breadthFail || (v.breadthFail = {});
    const tryBuild = (type, placer) => {
      if (now - (fail[type] ?? -1e9) < 45) return false;
      const n0 = v.buildings.length;
      const r = build(type, placer);
      if (r) realm.set(type, rc(type) + 1);
      else if (v.need !== type && v.buildings.length === n0) fail[type] = now;
      return r;
    };
    const out = (type, minR, extra) => () => this._placeOutskirts(v, type, Math.max(minR, v.radius * 0.6), v.buildRadius + extra, null, null);
    const near = (type, other) => () => this.placeAlongRoad(v, type, this._bias(v, other));
    let towns = 0;
    for (const vid of K.villages) if (this.villages[vid]?.tier >= 1) towns++;
    // food
    if (room() && has('husbandry') && v.fieldCount >= 10 && count('pasture') < (town ? 2 : 1)) tryBuild('pasture', out('pasture', 3, 5));
    if (room() && has('preservation') && (town || pop >= 20) && count('smokehouse') === 0) tryBuild('smokehouse', near('smokehouse', 'granary'));
    if (room() && has('canning') && (city || isCap || (town && v.fieldCount >= 24)) && count('cannery') === 0 && rc('cannery') < Math.max(1, Math.ceil(towns / 3))) tryBuild('cannery', out('cannery', 4, 5));
    if (room() && has('tractors') && town && v.fieldCount >= 14 && count('silo') === 0) tryBuild('silo', out('silo', 3, 4));
    if (room() && has('hybridcrops') && town && (v.dry || v.fieldCount >= 20) && count('greenhouse') === 0) tryBuild('greenhouse', out('greenhouse', 3, 5));
    if (room() && has('vertfarms') && (city || isCap) && count('vertfarm') === 0 && rc('vertfarm') < Math.max(1, Math.ceil(towns / 2))) tryBuild('vertfarm', near('vertfarm', 'market'));
    // medicine
    if (room() && has('quarantine') && (town || pop >= 26) && count('lazaretto') === 0 && !has('antibiotics')) tryBuild('lazaretto', out('lazaretto', 5, 6));
    if (room() && has('vaccination') && town && count('clinic') === 0) tryBuild('clinic');
    if (room() && has('antibiotics') && (city || isCap || towns <= 2) && count('hospital') === 0 && rc('hospital') < Math.max(1, Math.ceil(towns / 2))) tryBuild('hospital', near('hospital', 'hall'));
    if (room() && has('genetics') && (isCap || city) && rc('genelab') === 0) tryBuild('genelab', out('genelab', 3, 4));
    // biomes
    if (room() && has('qanats') && v.dry && count('qanat') < 1 + v.tier) tryBuild('qanat', near('qanat', 'well'));
    if (room() && has('forestry') && (town || pop >= 24) && count('nursery') === 0) tryBuild('nursery', out('nursery', 4, 6));
    if (room() && has('levees') && v.lowland && (town || pop >= 24) && count('levee') < (city ? 3 : 2)) tryBuild('levee', () => this._placeByWater(v, 'levee'));
    if (room() && has('forecasting') && town && count('weatherstation') === 0 && rc('weatherstation') < Math.max(1, Math.ceil(towns / 3))) tryBuild('weatherstation', out('weatherstation', 4, 4));
    if (room() && has('desalination') && v.coastal && (v.dry || town) && count('docks') > 0 && count('desal') === 0 && rc('desal') < Math.max(1, Math.ceil(towns / 2))) tryBuild('desal', () => this._placeDocks(v, 'desal') || this._placeByWater(v, 'desal'));
    if (room() && has('terraforming') && (city || isCap) && count('climatetower') === 0 && rc('climatetower') < 3) tryBuild('climatetower', out('climatetower', 5, 6));
    // city development
    if (room() && has('firebrigade') && (town || pop >= 24) && count('firestation') === 0) tryBuild('firestation', near('firestation', 'hall'));
    if (room() && has('smartcity') && (city || isCap) && count('controlspire') === 0) tryBuild('controlspire', near('controlspire', 'market'));
    // urban planning
    if (room() && has('gardencity') && town && count('park') < v.tier) tryBuild('park');
    // defense against the sky: a station in the capital and the cities
    if (room() && has('skyshield') && (isCap || city) && count('skyshield') === 0 && rc('skyshield') < Math.max(1, Math.ceil(towns / 2))) tryBuild('skyshield', out('skyshield', 5, 7));
  },
  _anyBreadth(k) {
    for (const t of k.techs) if (BREADTH_TECH.has(t)) return true;
    return false;
  },
  // breadth buildings of each type a realm has (cached a moment)
  _breadthRealm(K) {
    const t = this.game.time.total;
    const C = this._brc || (this._brc = { t: -1, v: -1, by: new Map() });
    if (C.t !== t || C.v !== this.version) {
      C.t = t;
      C.v = this.version;
      C.by.clear();
      for (const b of this.buildings) {
        if (!b.alive || !BREADTH_TYPES.has(b.type)) continue;
        let m = C.by.get(b.kingdom);
        if (!m) C.by.set(b.kingdom, (m = new Map()));
        m.set(b.type, (m.get(b.type) || 0) + 1);
      }
    }
    let m = C.by.get(K.id);
    if (!m) C.by.set(K.id, (m = new Map()));
    return m;
  },

  // ------------------------------------------------------------ the realm at large
  // Every 2 s (from _modernTick, after the towns' heights are set).
  _breadthTick(dt) {
    const now = this.game.time.total;
    const g = this.game;
    // what each realm has built (types), once
    const realmB = new Map();
    for (const b of this.buildings) {
      if (!b.alive || b.constructing) continue;
      if (!BREADTH_TYPES.has(b.type) && b.type !== 'campus' && b.type !== 'launchpad' && b.type !== 'spaceport') continue;
      let s = realmB.get(b.kingdom);
      if (!s) realmB.set(b.kingdom, (s = new Map()));
      s.set(b.type, (s.get(b.type) || 0) + 1);
    }
    let fireSig = 0;
    const shields = [];
    for (const b of this.buildings) if (b.alive && !b.constructing && b.type === 'skyshield') shields.push(b);
    for (const v of this.villages) {
      if (!v.alive) continue;
      const k = this.kingdoms[v.kingdom];
      const has = (t) => !!k?.techs?.has(t);
      const R = realmB.get(v.kingdom);
      const here = {};
      for (const b of v.buildings) if (b.alive && !b.constructing && BREADTH_TYPES.has(b.type)) here[b.type] = (here[b.type] || 0) + 1;
      if (v.dry == null || now - (v.landT || -1e9) > 60) this._surveyLand(v);
      // the guards
      // Blackout (god power): the town's power stays off until it ends
      if (v.blackoutUntil > now) v.powered = false;
      const G = v.guard || (v.guard = { fire: 0, quake: 0, flood: 0, storm: 0, meteor: 0 });
      const fs = here.firestation ? 1 : R?.get('firestation') ? 0.55 : 0;
      G.fire = has('firebrigade') ? (has('fireengines') && fs ? 0.6 + 0.3 * fs : 0.25 + 0.35 * fs) + (has('buildcodes') ? 0.08 : 0) : 0;
      G.quake = has('seismic') ? 0.8 : 0;
      G.flood = has('levees') ? (here.levee || !v.lowland ? 0.75 : 0.4) : 0;
      G.storm = has('forecasting') ? (R?.get('weatherstation') ? 0.75 : 0.4) : 0;
      if (has('smartcity') && (here.controlspire || R?.get('controlspire'))) for (const d of DANGERS) if (d !== 'meteor') G[d] = Math.min(0.95, G[d] + 0.12);
      G.meteor = 0;
      if (shields.length && has('skyshield'))
        for (const s of shields)
          if (s.kingdom === v.kingdom && Math.hypot(s.x - v.cx, s.z - v.cz) < 70 * this._villageSpread()) G.meteor = 1;
      G.fire = Math.min(0.95, G.fire);
      if (G.fire > 0) fireSig += v.id * 7 + Math.round(G.fire * 20) + Math.round(v.radius);
      v.med = { clinic: !!here.clinic, hospital: !!(here.hospital || here.genelab) };
      // food: smokehouses keep stores, cold building and vertical farms ease the winter
      v.spoil = has('preservation') ? (here.smokehouse ? 0.3 : 0.55) : 1;
      v.winterNeed = has('vertfarms') ? 1.0 : has('coldbuild') ? 1.06 : 1.2;
      v.farmEase = has('tractors') ? 1.8 : has('canning') ? 1.2 : 1;
      if (here.pasture) v.food += here.pasture * 0.5 * dt;
      if (here.vertfarm) v.food += here.vertfarm * 1.6 * dt;
      // desalination: a dry coast cannot starve
      if (here.desal && v.food < v.pop * 1.5) v.food = v.pop * 1.5;
      // growth: transit, smart cities and garden cities (and renewal, renewal.js)
      let m = 1;
      if (has('transit') && v.tier >= 1) m *= 1.08;
      if (has('smartcity')) m *= 1.06;
      if (has('gardencity')) m *= here.park ? 1.25 : 1.12;
      m *= 1 + 0.04 * Math.min(12, v.renewed || 0);
      v.tallMul = Math.min(2.6, (v.tallMul || 1) * m);
    }
    if (fireSig !== this._fireSig || !this.fireGuard) {
      this._fireSig = fireSig;
      this._buildFireGrid();
    }
    for (const k of this.kingdoms) {
      if (!k.alive || !k.villages.length || !k.techs) continue;
      // remembered dangers fade over the years
      if (k.dangers) for (const d in k.dangers) k.dangers[d] = Math.max(0, k.dangers[d] - dt / (YEAR * 15));
      if (!this._anyBreadth(k)) continue;
      const R = realmB.get(k.id);
      const has = (t) => k.techs.has(t);
      if (has('canning') && R?.get('cannery')) this._tinnedFood(k);
      if (has('rotation')) this._rotation(k, now);
      if (has('forestry') && R?.get('nursery') && now - (k.forestT || 0) > 12) {
        k.forestT = now;
        this._replant(k);
      }
      if (has('terraforming') && R?.get('climatetower') && now - (k.terraT || 0) > 10) {
        k.terraT = now;
        this._terraform(k);
      }
      if (has('forecasting') && R?.get('weatherstation')) this._stormWatch(k, now);
      if (has('quarantine')) this._plagueFlags(k, now);
      if (has('nanomed') && now - (k.droneT || 0) > 15) {
        k.droneT = now;
        this._medDrones(k);
      }
      if (now - (k.roleT || 0) > 6) {
        k.roleT = now;
        this._roles(k, R);
      }
      if (has('buildcodes') && R?.get('firestation')) this._firstUse(k, 'hydrant');
      if (has('seismic') && (k.era || 0) >= 6) this._firstUse(k, 'seismic');
      if (has('zoning') && R) this._firstUse(k, 'zoning');
      if (has('transit') && k.villages.some((id) => this.villages[id]?.tier >= 1)) this._firstUse(k, 'transit');
    }
    // town fires: the brigades are called (Fleets sends fire engines)
    this._fireCalls(now);
    this._renewalTick?.(dt);
  },

  // Dry land, cold land and low land around a town (planning and guards).
  _surveyLand(v) {
    const w = this.world;
    v.landT = this.game.time.total;
    let n = 0,
      dry = 0,
      cold = 0,
      low = 0;
    w.forEachInRadius(v.cx, v.cz, Math.max(6, v.radius + 4), (x, y, d, i) => {
      n++;
      const t = w.type[i];
      if (t === TILE.DESERT || t === TILE.SAND || t === TILE.SAVANNA) dry++;
      else if (t === TILE.SNOW || t === TILE.TUNDRA || t === TILE.ICE) cold++;
      const h = w.height[i];
      if (h < SEA_LEVEL + 0.8) low++;
    });
    v.dry = dry > n * 0.25;
    v.cold = cold > n * 0.25;
    v.lowland = low > n * 0.08;
    const k = this.kingdoms[v.kingdom];
    if (k) k.harsh = (v.dry || v.cold ? 1 : 0) + (k.harsh || 0) * 0.5;
  },

  // the fire guard as a coarse grid of the towns' ground
  _buildFireGrid() {
    const w = this.world;
    const cw = Math.ceil(w.w / CELL),
      ch = Math.ceil(w.h / CELL);
    let G = this.fireGuard;
    if (!G || G.cw !== cw || G.ch !== ch) G = this.fireGuard = { data: new Uint8Array(cw * ch), cw, ch, cell: CELL };
    G.data.fill(0);
    for (const v of this.villages) {
      const f = v.alive ? v.guard?.fire || 0 : 0;
      if (f <= 0) continue;
      const r = (v.radius || 8) + 4;
      const x0 = Math.max(0, Math.floor((v.cx - r) / CELL)),
        x1 = Math.min(cw - 1, Math.floor((v.cx + r) / CELL));
      const y0 = Math.max(0, Math.floor((v.cz - r) / CELL)),
        y1 = Math.min(ch - 1, Math.floor((v.cz + r) / CELL));
      const val = Math.round(f * 255);
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          if (Math.hypot((x + 0.5) * CELL - v.cx, (y + 0.5) * CELL - v.cz) > r + CELL * 0.7) continue;
          const i = y * cw + x;
          if (val > G.data[i]) G.data[i] = val;
        }
    }
  },

  // A town on fire: the brigade answers (and the chronicle notes its first save).
  _fireCalls(now) {
    for (const v of this.villages) {
      if (!v.alive || !(v.guard?.fire > 0)) continue;
      let burning = null;
      for (const b of v.buildings) if (b.alive && b.burning > 0.1) burning = b;
      const k = this.kingdoms[v.kingdom];
      if (burning) {
        if (!v.fireAt) {
          v.fireAt = now;
          v.fireB = burning.id;
          this.game.events.emit('civ:alarm', { kind: 'fire', x: burning.x, z: burning.z, village: v.id, kingdom: v.kingdom, building: burning.id });
          if (k?.techs?.has('fireengines')) this._firstUse(k, 'fireengine', { x: burning.x, z: burning.z });
        }
      } else if (v.fireAt) {
        // the fire is out and the building stands: the brigade saved it
        const b = this._bById.get(v.fireB);
        if (b?.alive && k && now - v.fireAt < 60) this._firstUse(k, 'brigade', { x: b.x, z: b.z });
        v.fireAt = null;
      }
    }
  },

  // Canning: tinned food reaches the starving towns of the realm, however far.
  _tinnedFood(k) {
    const vs = [];
    for (const vid of k.villages) {
      const v = this.villages[vid];
      if (v?.alive) vs.push(v);
    }
    const now = this.game.time.total;
    const hungry = [];
    for (const v of vs) {
      if (v.starving || v.food < v.pop * 0.8) hungry.push(v);
      else if (v.food > v.pop * 1.5) v._wantT = null; // (a cart's few months' meals do not end the want)
    }
    if (!hungry.length) return;
    for (const to of hungry) {
      // (round 21) relief takes time to gather and ship: the first tins reach
      // a town after about a year of want, then a shipment every half year,
      // each at most a few months' meals (in the Future era a Drought used to
      // be answered within 5 s and nobody went hungry)
      if (to._wantT == null) to._wantT = now;
      if (now - to._wantT < RELIEF_WAIT || now - (to._tinT ?? -1e9) < RELIEF_EVERY) continue;
      let from = null;
      for (const o of vs) if (o !== to && o.food > o.pop * 3 + 20 && (!from || o.food > from.food)) from = o;
      // the cannery's own stores: a little even when no town has plenty
      // (round 29: at least a few cases, and about a month's meals for the
      // town; the old twentieth of a meal a head was under the floor below
      // for every town of fewer than forty, and no tins ever reached one)
      let amt = from ? Math.min(from.food - (from.pop * 3 + 10), to.pop * RELIEF_SHARE) : 0;
      if (!(amt >= RELIEF_MIN)) {
        from = null;
        amt = Math.max(RELIEF_MIN, to.pop * RELIEF_OWN);
      }
      to._tinT = now;
      if (from) from.food -= amt;
      to.food += amt * 0.95;
      to.emptyT = 0;
      this._loss(k, 'tinnedFood', amt);
      if (to.starving) this._firstUse(k, 'tinned', { x: to.cx, z: to.cz });
    }
  },

  // Crop Rotation: one plot in four of each town lies fallow under clover for
  // a year, in turn (the harvest bonus more than pays for it).
  _rotation(k, now) {
    const yr = Math.floor(now / YEAR);
    if (k.rotYear === yr) return;
    k.rotYear = yr;
    const w = this.world;
    let shown = false;
    for (const vid of k.villages) {
      const v = this.villages[vid];
      if (!v?.alive || v.plots.length < 4) continue;
      for (let i = 0; i < v.plots.length; i++) {
        const p = v.plots[i];
        const fallow = (i + yr) % 4 === 0;
        if (fallow === !!p.fallow) continue;
        p.fallow = fallow;
        for (const t of p.tiles) {
          if (w.type[t] !== TILE.FARMLAND || this.use[t] !== USE.PLOT) continue;
          const f = w.flora[t];
          if (fallow && (f === FLORA.NONE || f === FLORA.WHEAT)) w.setFlora(t % w.w, (t / w.w) | 0, FLORA.FLOWERS, 0.6);
          else if (!fallow && f === FLORA.FLOWERS) w.setFlora(t % w.w, (t / w.w) | 0, FLORA.NONE);
        }
        if (fallow) shown = true;
      }
      this.fieldVersion++;
    }
    if (shown) this._firstUse(k, 'rotation');
  },

  // Forestry: foresters replant stumps and bare ground near towns with a nursery.
  _replant(k) {
    const w = this.world;
    let n = 0;
    for (const vid of k.villages) {
      const v = this.villages[vid];
      if (!v?.alive || !v.buildings.some((b) => b.alive && b.type === 'nursery' && !b.constructing)) continue;
      const species = { vale: [FLORA.OAK, FLORA.BIRCH], dune: [FLORA.PALM, FLORA.ACACIA], frost: [FLORA.PINE, FLORA.PINE], mire: [FLORA.JUNGLE_TREE, FLORA.SWAMP_TREE] }[baseCulture(v.culture)] || [FLORA.OAK];
      const r = v.buildRadius + 14 * FOOTPRINT.scale;
      let planted = 0;
      w.forEachInRadius(v.cx, v.cz, r, (x, y, d, i) => {
        if (planted >= 12 || d * r < v.buildRadius) return;
        if (w.flora[i] !== FLORA.STUMP || this.use[i] !== USE.FREE) return;
        w.setFlora(x, y, species[(x + y) % species.length], 0.25);
        planted++;
      });
      n += planted;
      if (planted) this._loss(k, 'replanted', planted);
    }
    if (n >= 3) this._firstUse(k, 'replant');
  },

  // Terraforming: desert, tundra and snow near a city with a climate tower
  // slowly turn to grassland (a few tiles every ten seconds, widening).
  _terraform(k) {
    const w = this.world;
    for (const b of this.buildings) {
      if (!b.alive || b.constructing || b.type !== 'climatetower' || b.kingdom !== k.id) continue;
      b.reach = Math.min(30, (b.reach || 6) + 0.4);
      let done = 0;
      for (let t = 0; t < 40 && done < 8; t++) {
        const a = this.rng.float(0, Math.PI * 2),
          r = Math.sqrt(this.rng.next()) * b.reach;
        const x = Math.floor(b.x + Math.cos(a) * r),
          y = Math.floor(b.z + Math.sin(a) * r);
        if (!w.inBounds(x, y)) continue;
        const i = y * w.w + x;
        const ty = w.type[i];
        if (w.height[i] < SEA_LEVEL + 0.4) continue;
        const to = ty === TILE.DESERT ? TILE.SAVANNA : ty === TILE.SAVANNA ? TILE.GRASS : ty === TILE.SNOW ? TILE.TUNDRA : ty === TILE.TUNDRA ? TILE.GRASS : -1;
        if (to < 0) continue;
        w.setType(x, y, to);
        done++;
      }
      if (done) {
        this._loss(k, 'greened', done);
        this._firstUse(k, 'greening', { x: b.x, z: b.z });
      }
    }
  },

  // Weather Forecasting: a storm, tornado or tsunami gives warning; the
  // people take shelter (shelterAt), ships make port and aircraft stay down.
  _stormWatch(k, now) {
    const g = this.game;
    const wt = g.env?.weather?.type;
    let danger = wt === 'storm' ? 'storm' : null;
    if (!danger)
      for (const e of g.disasters?.active || []) if (e?.kind === 'tornado' || e?.kind === 'tsunami') danger = e.kind;
    if (!danger) return;
    if (!(k.stormWarnUntil > now)) {
      const pos = this._kingdomPos?.(k);
      this._firstUse(k, 'stormwarn', pos);
      g.events.emit('civ:alarm', { kind: 'storm', danger, kingdom: k.id, x: pos?.x, z: pos?.z });
    }
    k.stormWarnUntil = now + 20;
  },

  // Quarantine: a plague flag flies over a sick person's house.
  _plagueFlags(k, now) {
    const P = this.game.disasters?.plagueSim;
    if (!P?.infected?.size) return;
    for (const u of P.infected) {
      if (!u.alive || u.kingdom !== k.id) continue;
      const b = this._bById.get(u.data?.civ?.home);
      if (!b?.alive) continue;
      if (!(b.quarantine > now)) this.version++;
      b.quarantine = now + 30;
      this._firstUse(k, 'quarantine', { x: b.x, z: b.z });
    }
  },

  // Nanomedicine: medical drones hop over the towns (Fleets draws them).
  _medDrones(k) {
    const F = this.game.fleet;
    if (!F?.requestFlight) return;
    for (const vid of k.villages) {
      const v = this.villages[vid];
      if (!v?.alive || v.tier < 1 || !v.hall?.alive || !this.rng.chance(0.4)) continue;
      const homes = v.buildings.filter((b) => b.alive && !b.constructing && (b.type === 'house' || b.type === 'apartment' || b.type === 'rowhouse'));
      if (!homes.length) continue;
      const to = homes[(this.rng.next() * homes.length) | 0];
      if (F.requestFlight({ kind: 'drone', kingdom: k.id, from: v.hall.id, to: to.id, cargo: { medical: 1 } })) this._firstUse(k, 'meddrone', { x: v.cx, z: v.cz });
    }
  },

  // New people (docs/TECH-BREADTH.md section 3): some townsfolk take a role
  // when the realm has the art and the building. Life draws them and gives
  // them their behavior.
  _roles(k, R) {
    const has = (t) => k.techs.has(t);
    for (const vid of k.villages) {
      const v = this.villages[vid];
      if (!v?.alive) continue;
      const here = {};
      for (const b of v.buildings) if (b.alive && !b.constructing) here[b.type] = 1;
      const want = {
        firefighter: has('firebrigade') && here.firestation ? (has('fireengines') ? 3 : 2) : 0,
        doctor: has('vaccination') && (here.clinic || here.hospital || here.genelab) ? (here.hospital ? 3 : 2) : has('quarantine') && here.lazaretto ? 1 : 0,
        forester: has('forestry') && here.nursery ? 2 : 0,
        police: (k.era || 0) >= 5 && v.tier >= 1 ? 1 + v.tier : 0,
        scientist: here.campus || here.genelab ? 2 + (here.campus && here.genelab ? 1 : 0) : 0,
        astronaut: here.launchpad || here.spaceport ? 2 : 0,
      };
      const cur = {};
      for (const u of v.members) {
        const r = u.data?.role;
        if (!ROLE_SET.has(r)) continue;
        if (!u.alive || (cur[r] || 0) >= want[r] || u.job === 'soldier' || u.job === 'king') {
          delete u.data.role;
          continue;
        }
        cur[r] = (cur[r] || 0) + 1;
      }
      for (const r of ROLE_SET) {
        let need = want[r] - (cur[r] || 0);
        if (need <= 0) continue;
        for (const u of v.members) {
          if (need <= 0) break;
          if (!u.alive || !u.data || u.data.role || u.age < ADULT_AGE + 2 || u.age > 58 || u.job === 'soldier' || u.job === 'king' || u.job === 'messenger' || u.job === 'healer' || u.data.civ?.army || u.data.civ?.royal) continue;
          u.data.role = r;
          need--;
          this._firstUse(k, r, { x: u.x, z: u.z });
        }
      }
    }
  },
};

export const BREADTH_TYPES = new Set(['pasture', 'smokehouse', 'lazaretto', 'qanat', 'nursery', 'firestation', 'cannery', 'silo', 'greenhouse', 'vertfarm', 'clinic', 'hospital', 'genelab', 'levee', 'weatherstation', 'desal', 'climatetower', 'controlspire', 'park', 'skyshield']);
const BREADTH_TECH = new Set(['husbandry', 'rotation', 'preservation', 'canning', 'tractors', 'hybridcrops', 'vertfarms', 'quarantine', 'vaccination', 'antibiotics', 'genetics', 'nanomed', 'terracing', 'qanats', 'coldbuild', 'forestry', 'levees', 'forecasting', 'desalination', 'terraforming', 'firebrigade', 'buildcodes', 'fireengines', 'seismic', 'smartcity', 'townplan', 'zoning', 'transit', 'heritage', 'renewal', 'gardencity', 'skyshield']);
void clamp;
void FLORA_INFO;
