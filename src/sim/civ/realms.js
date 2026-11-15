import { TILE, TILE_INFO, FLORA, SEA_LEVEL } from '../../world/constants.js';
import { geoInfo, geoRegion, geoTile } from '../../world/geo.js';
import { HERALDRY, colorDist } from './cultures.js';
import { realmsFor } from './places/index.js';
import { USE, SPIRAL, spiralCount, clamp } from './util.js';

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

    // 1. capitals, most important realm first
    const seated = [];
    for (let i = 0; i < data.length && seated.length < maxRealms && seated.length < maxVillages; i++) {
      const r = data[i];
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
      if (!site) continue;
      const culture = r.culture || this._cultureAt(site.x, site.y);
      const v = this.foundVillage(site.x, site.y, {
        culture,
        starter: true,
        settlers: 11 + rng.int(0, 1),
        silent: true,
        searchR: 1,
        name: seat.name,
        realmName: r.name,
        realmIdx: i,
        color: r.color != null ? this._nearestTincture(r.color, site.x, site.y) : null,
      });
      if (v) seated.push({ k: this.kingdoms[v.kingdom], r, seat, next: 0, given: 0 });
    }
    if (!seated.length) return false;

    // 2. a few of each realm's largest cities: the bigger the realm (the
    // earlier in the list), the more it gets; the first two share alike (the
    // Mainland Region and the ROC on the Asian maps)
    let villages = seated.length;
    seated.forEach((e, rank) => (e.weight = 1 / (1 + 0.35 * Math.max(0, rank - 1))));
    while (villages < maxVillages) {
      let best = null,
        bs = -1;
      for (const e of seated) {
        if (e.done) continue;
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
        if (c === best.seat || !geoTile(w, c.lon, c.lat)) continue;
        const site = this._realSite(c.lon, c.lat, reach, best.k.id);
        if (!site) continue;
        const v = this.foundVillage(site.x, site.y, { kingdom: best.k.id, culture: best.k.culture, starter: true, settlers: 9 + rng.int(0, 1), silent: true, searchR: 1, name: c.name });
        if (v) {
          ok = true;
          best.given++;
          villages++;
          break;
        }
      }
      if (!ok) best.done = true;
    }
    return true;
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
  _realSiteScan(cx, cz, reach, kingdom) {
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
      if (!this._dryPad(x, y)) continue;
      if (!this._realGapOK(x + 0.5, y + 0.5, kingdom, this.landId[y * w.w + x])) continue;
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
  _realGapOK(cx, cz, kingdom, land) {
    for (const v of this.villages) {
      if (!v.alive) continue;
      const d = Math.hypot(v.cx - cx, v.cz - cz);
      const gap = v.kingdom === kingdom ? GAP_SAME : v.landId === land ? GAP_LAND : GAP_SEA;
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
  // within reach, or else any real place right there; null when there is
  // none (the caller then makes up a name).
  _realPlaceName(k, tx, ty, fromId = null) {
    const places = this._places;
    if (!places || !places.length) return null;
    const own = k?.realm ?? this.kingdoms[fromId]?.realm ?? -1;
    const taken = new Set();
    for (const v of this.villages) if (v.alive) taken.add(v.name);
    const R = this._placeReach;
    let best = null,
      bs = Infinity;
    for (const p of places) {
      const mine = p.realm === own;
      const d = Math.hypot(p.x - tx, p.z - ty);
      if (d > (mine ? R.own : R.any)) continue;
      if (taken.has(p.name)) continue;
      const sc = d - (mine ? R.bonus : 0);
      if (sc < bs) {
        bs = sc;
        best = p;
      }
    }
    if (!best) return null;
    this.usedNames.add(best.name);
    return best.name;
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
