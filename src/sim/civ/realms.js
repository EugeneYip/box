import { TILE, TILE_INFO, FLORA, SEA_LEVEL } from '../../world/constants.js';
import { geoInfo, geoRegion, geoTile } from '../../world/geo.js';
import { HERALDRY, colorDist, realStyleName, REAL_TITLE } from './cultures.js';
import { realmsFor, regionStyle } from './places/index.js';
import { peopleCultureId } from './peoples.js';
import { USE, SPIRAL, spiralCount, clamp, YEAR } from './util.js';

// Real realms on World Map worlds (contract: docs/REGIONS.md section 3).
// A map of the Earth (or of one of its regions) starts with real countries
// seated at their capitals and a few of their largest cities, and villages
// founded later take the names of the real cities around them. Mixed into
// Civilization.prototype.

// Village spacing at the start (tiles): within one realm, between realms on
// one landmass, and across water.
const GAP_SAME = 9,
  GAP_LAND = 10,
  GAP_SEA = 7;

export const realms = {
  // The real realms for this world's region, or null (square presets).
  _realmData() {
    const region = geoRegion(this.world);
    const list = region ? realmsFor(region) : null;
    return list && list.length ? list : null;
  },

  // Tiles per degree at this map's scale (the smaller of the two axes).
  _tilesPerDegree() {
    const g = geoInfo(this.world);
    return Math.min(this.world.w / (g.lonMax - g.lonMin), this.world.h / (g.latMax - g.latMin));
  },

  // Seed the real realms; returns false when nothing could be placed (the
  // caller then falls back to random starts). `n` (an explicit starting
  // village count) caps the villages and realms.
  seedRealRealms(n = null) {
    const data = this._realmData();
    if (!data) return false;
    const w = this.world;
    const rng = this.rng;
    const s = Math.sqrt((w.w * w.h) / (1024 * 512)); // 1 on Vast and the regional maps
    let maxRealms = Math.max(4, Math.round(20 * s));
    let maxVillages = Math.max(maxRealms, Math.round(Math.min(0.75 * this.budget.villages, 26 * s)));
    if (n != null) {
      maxVillages = n;
      maxRealms = Math.min(maxRealms, n);
    }
    const tpd = this._tilesPerDegree();
    const reach = clamp(Math.round(0.15 * tpd), 6, 16); // how far a capital may move to find a site
    // every real place inside the window, for naming villages later
    this._places = [];
    data.forEach((r, i) => {
      for (const c of [r.capital, ...r.cities]) {
        const p = geoTile(w, c.lon, c.lat);
        if (p) this._places.push({ name: c.name, x: p.x, z: p.z, realm: i });
      }
    });
    // a new village takes a real name from this far (tiles): its own realm's
    // cities within about 4.5 degrees, any real place within about 3.5, but
    // never less than a village's own reach on the smaller whole-Earth maps
    this._placeReach = { own: clamp(4.5 * tpd, 9, 20), any: clamp(3.5 * tpd, 7, 16), bonus: 4 };

    // 1. capitals, most important realm first; a realm with cities that must
    // exist at the start (docs/REGIONS.md section 4) is seated whatever its
    // rank, without taking the place of a realm that would be seated anyway
    const seated = [];
    const forceMust = n == null;
    let regular = 0;
    for (let i = 0; i < data.length; i++) {
      const r = data[i];
      if (r.seed === false) continue; // listed for its place names only
      const full = regular >= maxRealms || regular >= maxVillages;
      if (full && !(forceMust && r.must?.length)) continue;
      const seats = r.edge ? [r.capital, ...r.cities] : [r.capital];
      let site = null,
        seat = null,
        tries = 0;
      for (const c of seats) {
        if (!geoTile(w, c.lon, c.lat)) continue; // outside the window
        site = this._realSite(c.lon, c.lat, reach, -1);
        if (site) {
          seat = c;
          break;
        }
        if (++tries >= 3) break;
      }
      // (a realm with cities that must exist is seated at its capital, nudged
      // as far as it takes)
      const forced = forceMust && r.must?.length && !site && geoTile(w, r.capital.lon, r.capital.lat);
      if (!site && !forced) continue;
      const at = site || geoTile(w, r.capital.lon, r.capital.lat);
      const opts = {
        culture: this._realCulture(r, Math.floor(at.x), Math.floor(at.z ?? at.y)),
        starter: true,
        settlers: 11 + rng.int(0, 1),
        silent: true,
        searchR: 1,
        name: (seat || r.capital).name,
        realmName: r.name,
        realmIdx: i,
        color: r.color != null ? this._nearestTincture(r.color, at.x, at.z ?? at.y) : null,
      };
      const v = site ? this.foundVillage(site.x, site.y, opts) : this._seedMustCity(null, r.capital, opts);
      if (v) {
        const k = this.kingdoms[v.kingdom];
        k.seeded = true; // a real country of the start (sturdier: politics.js)
        seated.push({ k, r, seat, next: 0, given: 0, extra: full });
        if (!full) regular++;
      }
    }
    if (!seated.length) return false;

    // 2. the cities that must exist at the start (docs/REGIONS.md section 4),
    // wherever they fall inside the window, at or near their real places:
    // in addition to the usual villages, closer than the usual spacing when
    // they must be, never skipped. They are laid out before the usual cities
    // so that they find room near their real places, but the usual cities
    // below ignore them (and realms seated only for them) when spacing, so
    // the usual starting villages stay as they were.
    if (forceMust) {
      for (const e of seated) {
        if (e.extra) this.villages[e.k.capital]._must = true;
        for (const name of e.r.must || []) {
          if (e.k.villages.some((id) => this.villages[id]?.alive && this.villages[id].name === name)) continue;
          const c = name === e.r.capital.name ? e.r.capital : e.r.cities.find((p) => p.name === name);
          if (!c || !geoTile(w, c.lon, c.lat)) continue; // outside the window
          const v = this._seedMustCity(e.k, c);
          // (a realm's old seat, Nanjing when the ROC sits at Taipei, keeps
          // its neighbours apart as before but takes no usual town's place)
          if (v) v[name === e.r.oldSeat ? '_oldSeat' : '_must'] = true;
        }
      }
      this._gapIgnoreMust = true;
    }

    // 3. a few of each realm's largest cities: the bigger the realm (the
    // earlier in the list), the more it gets; the first two share alike (the
    // Mainland Region and the ROC on the Asian maps)
    let villages = regular;
    seated.forEach((e, rank) => (e.weight = 1 / (1 + 0.35 * Math.max(0, rank - 1))));
    while (villages < maxVillages) {
      let best = null,
        bs = -1;
      for (const e of seated) {
        if (e.done || e.extra) continue;
        const sc = e.weight / (1 + e.given);
        if (sc > bs) {
          bs = sc;
          best = e;
        }
      }
      if (!best) break;
      let ok = false;
      while (best.next < best.r.cities.length) {
        const c = best.r.cities[best.next++];
        const p = c === best.seat ? null : geoTile(w, c.lon, c.lat);
        if (!p) continue;
        // a city laid out above as one that must exist counts as one of the
        // usual ones when it would have been placed anyway
        const have = best.k.villages.map((id) => this.villages[id]).find((o) => o?.alive && (o._must || o._oldSeat) && o.name === c.name);
        if (have) {
          if (have._oldSeat || !this._realGapOK(p.x, p.z, best.k.id, this._landNear(Math.floor(p.x), Math.floor(p.z), reach))) continue;
          ok = true;
          best.given++;
          villages++;
          break;
        }
        const site = this._realSite(c.lon, c.lat, reach, best.k.id);
        let v = null;
        if (site) v = this.foundVillage(site.x, site.y, { kingdom: best.k.id, culture: best.k.culture, starter: true, settlers: 9 + rng.int(0, 1), silent: true, searchR: 1, name: c.name });
        // a usual city crowded only by a must-exist city's houses is still
        // placed, nudged like one (Los Angeles beside San Diego on Large)
        else if (this._gapIgnoreMust && this.villages.some((o) => o._must && o.alive && Math.hypot(o.cx - p.x, o.cz - p.z) < reach)) {
          if (this._realGapOK(p.x, p.z, best.k.id, this._landNear(Math.floor(p.x), Math.floor(p.z), reach))) v = this._seedMustCity(best.k, c);
        }
        if (v) {
          ok = true;
          best.given++;
          villages++;
          break;
        }
      }
      if (!ok) best.done = true;
    }

    this._gapIgnoreMust = false;
    for (const v of this.villages) delete v._must, delete v._oldSeat;
    this._kingdomTotals?.(); // realm cards show their people from the first frame
    return true;
  },

  // A city that must exist at the start: at its real place when the usual
  // spacing allows, else at the nearest site a few tiles from its neighbours
  // (closer on the smaller whole-Earth maps; rugged ground is levelled), else
  // at any room for a hall within a dozen tiles. `opts` are foundVillage's
  // (a realm's seat passes its realm's name and colors).
  _seedMustCity(k, c, opts = {}) {
    const base = { kingdom: k ? k.id : null, culture: k?.culture, starter: true, settlers: 9 + this.rng.int(0, 1), silent: true, name: c.name, ...opts };
    const avoid = [];
    for (const far of [false, true]) {
      for (let t = 0; t < 4; t++) {
        const site = this._mustSite(c.lon, c.lat, k ? k.id : -1, avoid, far);
        if (!site) break;
        avoid.push(site);
        if (site.mode > 0) this._levelSite(site.x, site.y);
        const v = this.foundVillage(site.x, site.y, { ...base, searchR: 2 });
        if (v) return v;
      }
      // an island too small for a hall at this map size (Puerto Rico on the
      // whole Earth) gets a little more shore rather than the city going to
      // a neighbour's land
      if (!far) {
        const pad = this._islandPad(c.lon, c.lat);
        const v = pad && this.foundVillage(pad.x, pad.y, { ...base, searchR: 1 });
        if (v) return v;
      }
    }
    const p = geoTile(this.world, c.lon, c.lat);
    return p ? this.foundVillage(Math.floor(p.x), Math.floor(p.z), { ...base, searchR: 12 }) : null;
  },

  // A 3x3 pad of low grassy shore within a few tiles of a real place, for a
  // city on an island that is only a tile or two at this map size (Puerto
  // Rico on the whole Earth) or on a coast that its neighbours have filled
  // (Korea on the Large map): the nearest unused block that touches real land
  // and keeps clear of other halls is raised just above the sea. Null when
  // there is none.
  _islandPad(lon, lat) {
    const w = this.world;
    const p = geoTile(w, lon, lat);
    if (!p) return null;
    const cx = Math.floor(p.x),
      cz = Math.floor(p.z);
    let at = null;
    const n = spiralCount(4);
    for (let k = 0; k < n && !at; k++) {
      const [dx, dy] = SPIRAL[k];
      const x = cx + dx,
        y = cz + dy;
      if (x < 7 || y < 7 || x > w.w - 8 || y > w.h - 8) continue;
      let land = 0,
        ok = true;
      for (let yy = y - 2; yy <= y + 2 && ok; yy++)
        for (let xx = x - 2; xx <= x + 2; xx++) {
          const i = yy * w.w + xx;
          const inner = Math.abs(xx - x) <= 1 && Math.abs(yy - y) <= 1;
          if (inner ? this.use[i] !== USE.FREE : this.use[i] === USE.BUILDING) {
            ok = false;
            break;
          }
          if (!inner) continue;
          const t = w.type[i];
          if (t === TILE.LAVA || t === TILE.ICE) ok = false;
          if (w.height[i] >= SEA_LEVEL) land++;
        }
      if (!ok || !land) continue;
      if (this.villages.some((v) => v.alive && Math.hypot(v.cx - x - 0.5, v.cz - y - 0.5) < 2.6)) continue;
      at = { x, y };
    }
    if (!at) return null;
    for (let yy = at.y - 1; yy <= at.y + 1; yy++)
      for (let xx = at.x - 1; xx <= at.x + 1; xx++) {
        const i = yy * w.w + xx;
        if (w.height[i] < SEA_LEVEL + 0.3) w.height[i] = SEA_LEVEL + 0.3;
        const t = w.type[i];
        if (!TILE_INFO[t]?.buildable || t === TILE.SAND || t === TILE.ROCK || t === TILE.SNOW) w.setType(xx, yy, TILE.GRASS);
        const f = w.flora[i];
        if (f === FLORA.BOULDER || f === FLORA.ROCK_SMALL) w.setFlora(xx, yy, FLORA.NONE);
      }
    w.markDirty('height', at.x - 2, at.y - 2, at.x + 2, at.y + 2);
    this._heightTouched(at.x - 3, at.y - 3, at.x + 3, at.y + 3);
    this._computeLand?.();
    return at;
  },

  _mustSite(lon, lat, kingdom, avoid = [], far = false) {
    const w = this.world;
    const p = geoTile(w, lon, lat);
    if (!p) return null;
    const cx = Math.floor(p.x),
      cz = Math.floor(p.z);
    const reach = clamp(Math.round(0.15 * this._tilesPerDegree()), 6, 16);
    const small = this._tilesPerDegree() < 2; // Large: a country spans a few tiles
    // near the real place first, with the spacing eased step by step, then
    // further out
    const tight = small ? 0.34 : 0.45;
    const steps = far
      ? [
          [tight, reach],
          [tight, reach + 4],
          [0.3, reach + 8],
        ]
      : [
          [1, 3],
          [0.7, 4],
          [0.5, 5],
          [tight, 5],
          [0.27, 5],
        ];
    for (const [gs, R] of steps) {
      const site = this._realSiteScan(cx, cz, R, kingdom, gs, avoid);
      if (site) return site;
    }
    return null;
  },

  // The culture of a real realm: its people ('vale~japanese': the Japanese,
  // in the game's timber-and-tile style, named from the Japanese pool), in
  // the style the data asks for when it overrides one; the land's own culture
  // only for a realm with no people listed.
  _realCulture(r, x, y) {
    const id = r.people ? peopleCultureId(r.people, r.culture) : null;
    return id || r.culture || this._cultureAt(x, y);
  },

  // The people of the real land at a tile (wanderers who settle there later),
  // or null where no real place is near.
  _realCultureAt(x, z) {
    if (!this._realMapOn()) return null;
    const idx = this._placeRealmAt(x, z);
    const r = idx >= 0 ? this._realmData()?.[idx] : null;
    return r ? this._realCulture(r, x, z) : null;
  },

  // A hall site (centre tile) near a real place: the nearest buildable spot
  // within `reach` tiles, kept apart from the villages already placed. A
  // place that already has a neighbour standing at it is skipped (the city is
  // not pushed elsewhere). Rugged or narrow land (Taiwan or Japan on the
  // whole Earth) gets a small levelled pad when nothing gentler is near.
  // Null when there is no land nearby at this size.
  _realSite(lon, lat, reach, kingdom) {
    const w = this.world;
    const p = geoTile(w, lon, lat);
    if (!p) return null;
    const cx = Math.floor(p.x),
      cz = Math.floor(p.z);
    if (!this._realGapOK(p.x, p.z, kingdom, this._landNear(cx, cz, reach))) return null;
    const site = this._realSiteScan(cx, cz, reach, kingdom);
    if (!site) return null;
    if (site.mode > 0) {
      this._levelSite(site.x, site.y);
      if (!this._footprintOK(site.x - 1, site.y - 1, 3, 3, 1.3)) return null;
    }
    return site;
  },

  // The nearest site, preferring (by a tile or two) gentle buildable ground
  // with room around it (mode 0) over steeper buildable ground (1) and over
  // any dry land that needs levelling (2).
  _realSiteScan(cx, cz, reach, kingdom, gapScale = 1, avoid = null) {
    const w = this.world;
    let best = null,
      bs = -Infinity;
    const n = spiralCount(reach);
    for (let k = 0; k < n; k++) {
      const [dx, dy, d] = SPIRAL[k];
      if (best && d - 1 > -bs) break; // nothing further out can win
      const x = cx + dx,
        y = cz + dy;
      if (x < 5 || y < 5 || x > w.w - 6 || y > w.h - 6) continue;
      if (avoid?.length && avoid.some((a) => Math.abs(a.x - x) <= 1 && Math.abs(a.y - y) <= 1)) continue;
      if (!this._dryPad(x, y)) continue;
      if (!this._realGapOK(x + 0.5, y + 0.5, kingdom, this.landId[y * w.w + x], gapScale)) continue;
      let mode = 2;
      if (this._footprintOK(x - 1, y - 1, 3, 3, 1.3) && this._roomAround(x, y, 0) >= 24) mode = 0;
      else if (this._footprintOK(x - 1, y - 1, 3, 3, 2.6) && this._roomAround(x, y, 1) >= 12) mode = 1;
      const room = this._roomAround(x, y, mode);
      if (mode === 2 && room < 10) continue;
      const sc = -d - mode + Math.min(room, 60) / 60;
      if (sc > bs) {
        bs = sc;
        best = { x, y, mode };
      }
    }
    return best;
  },

  // A 3x3 pad of dry, unused land (any slope, rock allowed).
  _dryPad(x, y) {
    const w = this.world;
    for (let yy = y - 1; yy <= y + 1; yy++)
      for (let xx = x - 1; xx <= x + 1; xx++) {
        const i = yy * w.w + xx;
        if (w.height[i] < SEA_LEVEL + 0.05 || this.use[i] !== USE.FREE || w.fire[i] > 0.05) return false;
        const t = w.type[i];
        if (t === TILE.ICE || t === TILE.LAVA || t === TILE.ROAD) return false;
      }
    return true;
  },

  // Level a small pad around a rugged site: bare rock becomes grass (or
  // tundra in the cold), boulders are cleared and the ground eases toward
  // the hall's height, so the hall and a few houses can stand.
  _levelSite(x, y) {
    const w = this.world;
    let sum = 0,
      cnt = 0;
    for (let yy = y - 1; yy <= y + 1; yy++)
      for (let xx = x - 1; xx <= x + 1; xx++) {
        sum += w.height[yy * w.w + xx];
        cnt++;
      }
    const target = Math.max(SEA_LEVEL + 0.2, sum / cnt);
    const R = 3.5;
    const n = spiralCount(R);
    for (let k = 0; k < n; k++) {
      const [dx, dy, d] = SPIRAL[k];
      const xx = x + dx,
        yy = y + dy;
      if (!w.inBounds(xx, yy)) continue;
      const i = yy * w.w + xx;
      if (w.height[i] < SEA_LEVEL + 0.05 || this.use[i] !== USE.FREE) continue;
      const t = w.type[i];
      if (t === TILE.ROCK || t === TILE.SNOW) w.setType(xx, yy, w.temperature[i] < 0.3 ? TILE.TUNDRA : TILE.GRASS);
      const f = w.flora[i];
      if (f === FLORA.BOULDER || f === FLORA.ROCK_SMALL) w.setFlora(xx, yy, FLORA.NONE);
      const kk = d <= 1.5 ? 1 : 0.85 * Math.max(0, 1 - (d - 1.5) / (R - 0.5));
      w.height[i] = Math.max(SEA_LEVEL + 0.06, w.height[i] + (target - w.height[i]) * kk);
    }
    const r = Math.ceil(R);
    w.markDirty('height', x - r, y - r, x + r, y + r);
    this._heightTouched(x - r - 1, y - r - 1, x + r + 1, y + r + 1);
  },

  // The landmass under (or nearest to) a tile, for the spacing rules.
  _landNear(cx, cz, reach) {
    const w = this.world;
    const n = spiralCount(reach);
    for (let k = 0; k < n; k++) {
      const [dx, dy] = SPIRAL[k];
      const x = cx + dx,
        y = cz + dy;
      if (!w.inBounds(x, y)) continue;
      const i = y * w.w + x;
      if (w.height[i] >= SEA_LEVEL) return this.landId[i];
    }
    return -1;
  },

  // No village too near (centre coordinates): wider gaps between realms on
  // one landmass than within a realm or across water.
  _realGapOK(cx, cz, kingdom, land, scale = 1) {
    for (const v of this.villages) {
      if (!v.alive || (v._must && this._gapIgnoreMust)) continue;
      const d = Math.hypot(v.cx - cx, v.cz - cz);
      const gap = scale * (v.kingdom === kingdom ? GAP_SAME : v.landId === land ? GAP_LAND : GAP_SEA);
      if (d < gap) return false;
    }
    return true;
  },

  // Room for a village within six tiles: buildable gentle ground (mode 0),
  // buildable ground of any slope (1) or any dry land (2).
  _roomAround(x, y, mode = 0) {
    const w = this.world;
    let room = 0;
    const n = spiralCount(6);
    for (let k = 0; k < n; k++) {
      const [dx, dy] = SPIRAL[k];
      const xx = x + dx,
        yy = y + dy;
      if (!w.inBounds(xx, yy)) continue;
      const i = yy * w.w + xx;
      if (w.height[i] < SEA_LEVEL + 0.05) continue;
      const t = w.type[i];
      if (mode === 2) {
        if (t !== TILE.ICE && t !== TILE.LAVA) room++;
        continue;
      }
      const ti = TILE_INFO[t];
      if (ti?.buildable && ti.walkable && (mode === 1 || w.slopeAt(xx, yy) < 1.1)) room++;
    }
    return room;
  },

  // The heraldic tincture nearest a requested colour, unless a neighbour
  // already wears one too close to it (then the usual pick decides).
  _nearestTincture(hex, x, y) {
    let best = null,
      bd = Infinity;
    for (const h of HERALDRY) {
      const d = colorDist(h.color, hex);
      if (d < bd) {
        bd = d;
        best = h;
      }
    }
    if (!best) return null;
    for (const k of this.kingdoms) {
      if (!k.alive) continue;
      const v = this.villages[k.capital];
      if (v && Math.hypot(v.cx - x, v.cz - y) < 90 && colorDist(k.color, best.color) < 0.15) return null;
    }
    return best.color;
  },

  // The real name for a village founded at (tx, ty) by realm k (or by
  // settlers from realm `fromId`): the nearest unused city of that realm
  // within reach, or else any real place right there; failing both, the
  // search widens (twice, then three times as far: a neighbouring realm's
  // towns). When every real name nearby is taken, a name in the style of the
  // land (Japanese, Korean, pinyin, ...); null only where the land has no
  // such style (the caller then makes up a name in the people's language).
  _realPlaceName(k, tx, ty, fromId = null) {
    const places = this._places;
    if (!places || !places.length) return null;
    const src = k || this.kingdoms[fromId];
    const own = src?.realm ?? src?.placesFrom ?? -1;
    const taken = new Set();
    for (const v of this.villages) if (v.alive) taken.add(v.name);
    const R = this._placeReach;
    for (const m of [1, 2, 3]) {
      let best = null,
        bs = Infinity;
      for (const p of places) {
        if (taken.has(p.name)) continue;
        const mine = p.realm === own;
        const d = Math.hypot(p.x - tx, p.z - ty);
        if (d > (mine ? R.own : R.any) * m) continue;
        const sc = d - (mine ? R.bonus * m : 0);
        if (sc < bs) {
          bs = sc;
          best = p;
        }
      }
      if (best) {
        this.usedNames.add(best.name);
        return best.name;
      }
    }
    const lang = this._langAt(tx, ty);
    return lang ? realStyleName(lang, this.rng, this.usedNames) : null;
  },

  // ------------------------------------------------------------ realms that rise later
  // True on a World Map world (real places were laid out at the start).
  _realMapOn() {
    return !!(this._places && this._places.length);
  },

  // The place-data realm (index) whose land a tile lies in: the realm of the
  // place called `name` when there is one near, else of the nearest place
  // within reach; -1 when no real place is near.
  _placeRealmAt(x, z, name = null) {
    const places = this._places;
    if (!places || x == null) return -1;
    const R = this._placeReach;
    let best = null,
      bd = Infinity;
    for (const p of places) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (name && p.name === name && d < R.own * 2) return p.realm;
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best && bd < R.any * 2 ? best.realm : -1;
  },

  // The naming style of the land at a tile: that of the real realm whose
  // places lie nearest, else the map's own (East Asian maps), else none.
  _langAt(x, z) {
    const data = this._realmData();
    if (!data) return null;
    const R = this._placeReach;
    let best = null,
      bd = Infinity;
    for (const p of this._places || []) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    const lang = best && bd < R.any * 6 ? data[best.realm]?.lang : null;
    return lang || regionStyle(geoRegion(this.world)).lang || null;
  },

  // The ruler's title in a realm on a World Map world: the realm's own (from
  // the place data: Emperor of Japan, Tsar of Russia, a daimyo in Kyushu, a
  // magistrate in Taipei), else the map's (a daimyo in a rebel city on the
  // Japan map), else a neutral Lord or Lady. Null on square maps (the
  // culture's own title applies there).
  _realTitle(k) {
    if (!this._realMapOn()) return null;
    if (k?.title) return k.title;
    const data = this._realmData();
    const idx = k?.realm ?? -1;
    const d = idx >= 0 ? data?.[idx] : null;
    if (d && d.title !== undefined) return d.title || REAL_TITLE;
    // a realm named after its seat takes the map's title only in the map's
    // own land (a rebel Ulsan on the Japan map has a lord, not a daimyo)
    const style = regionStyle(geoRegion(this.world));
    const land = data?.[k?.placesFrom ?? -1];
    if (land && style.lang && land.lang && land.lang !== style.lang) return REAL_TITLE;
    return style.title || REAL_TITLE;
  },

  // The name of a realm that rises on a World Map world (a rebellion, a
  // splinter colony, wanderers, a town freed by a god): no "Kingdom of" or
  // "Duchy of" on a map of the real world. In order:
  //  1. the fallen real realm the seat belonged to (France rises again);
  //  2. the real realm whose land the seat stands in, when no living realm
  //     carries its name (a country or region not seeded at the start, or one
  //     that has fallen: Austria breaks away from Germany around Vienna);
  //  3. the seat city's own name ("Kumamoto");
  //  4. the nearest real place no living realm is called by.
  // Returns { name, realm (place-data index or -1), placesFrom, color }.
  _newRealmName(base, opts = {}) {
    const data = this._realmData() || [];
    const living = new Set();
    for (const k of this.kingdoms) if (k.alive && k.villages.length) living.add(k.name);
    const d = this._placeRealmAt(opts.x, opts.z, base);
    const fallen = (idx) => {
      // the colours of the realm that fell, so it reads as the same country
      for (let i = this.kingdoms.length - 1; i >= 0; i--) {
        const k = this.kingdoms[i];
        if (k.realm === idx && !(k.alive && k.villages.length)) return k;
      }
      return null;
    };
    const real = (idx) => {
      const old = fallen(idx);
      return { name: data[idx].name, realm: idx, placesFrom: idx, color: old?.color ?? null, banner: old?.banner ?? null };
    };
    const H = this.kingdoms[opts.home];
    if (H && H.realm >= 0 && data[H.realm] && !living.has(data[H.realm].name)) return real(H.realm);
    if (d >= 0 && data[d] && !living.has(data[d].name)) return real(d);
    if (base && !living.has(base)) return { name: base, realm: -1, placesFrom: d };
    let best = null,
      bd = Infinity;
    for (const p of this._places || []) {
      if (living.has(p.name)) continue;
      const dd = Math.hypot(p.x - (opts.x ?? 0), p.z - (opts.z ?? 0));
      if (dd < bd) {
        bd = dd;
        best = p;
      }
    }
    return { name: best ? best.name : base, realm: -1, placesFrom: d };
  },

  // The real realm a town belongs to (World Map): the first real realm that
  // held it (its seed, its founder, or the first real crown to take it),
  // while that realm still stands. A town held by someone else longs for it
  // and, when it rises, goes back to it instead of crowning a realm of its own.
  _homeRealm(v) {
    if (!this._realMapOn() || v.home == null) return null;
    const H = this.kingdoms[v.home];
    return H && H.alive && H.villages.length && H.realm >= 0 ? H : null;
  },

  // A real realm whose last town falls is not wiped from the map at once: the
  // court flees with the townsfolk who escape and raises a new seat at one of
  // the realm's own real cities on free land (once in fifteen years).
  // Returns the new seat, or null (the realm then falls).
  _courtInExile(k, lost) {
    if (!this._realMapOn() || !(k.realm >= 0) || !lost) return null;
    const now = this.game.time.total;
    if (now - (k.exileT ?? -1e9) < YEAR * 15) return null;
    if (this._aliveVillageCount() >= this.budget.villages + 2) return null;
    const w = this.world;
    const taken = new Set();
    for (const v of this.villages) if (v.alive) taken.add(v.name);
    // (a small country on the whole Earth spans only a dozen tiles)
    const R = this._placeReach;
    const near = clamp(0.8 * R.any, 6, 14),
      gap = clamp(R.any, 8, 13);
    const cands = [];
    for (const p of this._places) {
      if (p.realm !== k.realm || taken.has(p.name)) continue;
      const d = Math.hypot(p.x - lost.cx, p.z - lost.cz);
      if (d < near || d > 150) continue;
      const x = Math.floor(p.x),
        z = Math.floor(p.z);
      if (!w.inBounds(x, z)) continue;
      const o = w.owner[z * w.w + x];
      if (o >= 0 && o !== k.id) continue;
      if (this.villages.some((v) => v.alive && Math.hypot(v.cx - p.x, v.cz - p.z) < gap)) continue;
      cands.push({ p, d });
    }
    cands.sort((a, b) => a.d - b.d);
    // the townsfolk who escape follow the court (soldiers stay to be taken)
    const folk = [...lost.members].filter((u) => u.alive && u.job !== 'soldier' && u.job !== 'king' && !u.data.civ?.army).slice(0, 9);
    for (const { p } of cands.slice(0, 4)) {
      const v = this.foundVillage(Math.floor(p.x), Math.floor(p.z), {
        kingdom: k.id,
        culture: k.culture,
        name: p.name,
        units: folk.length >= 5 ? folk : undefined,
        settlers: folk.length >= 5 ? undefined : 7,
        starter: true,
        houses: 2,
        searchR: 8,
        silent: true,
      });
      if (!v) continue;
      k.exileT = now;
      k.capital = v.id;
      v.home = k.id;
      return v;
    }
    return null;
  },

  // "the Kingdom of Thornholm", but "Japan" (real realms carry plain names).
  _theK(k) {
    if (!k) return 'nobody';
    return k.plain ? k.name : 'the ' + k.name;
  },
  theKingdomName(id) {
    const k = this.kingdoms[id];
    return k ? this._theK(k) : 'the wanderers';
  },
};
