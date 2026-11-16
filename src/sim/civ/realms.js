import { TILE, TILE_INFO, FLORA, SEA_LEVEL } from '../../world/constants.js';
import { geoInfo, geoRegion, geoTile } from '../../world/geo.js';
import { HERALDRY, colorDist, realStyleName, REAL_TITLE } from './cultures.js';
import { realmsFor, regionStyle } from './places/index.js';
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

    // 1. capitals, most important realm first
    const seated = [];
    for (let i = 0; i < data.length && seated.length < maxRealms && seated.length < maxVillages; i++) {
      const r = data[i];
      if (r.seed === false) continue; // listed for its place names only
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
      if (v) {
        const k = this.kingdoms[v.kingdom];
        k.seeded = true; // a real country of the start (sturdier: politics.js)
        seated.push({ k, r, seat, next: 0, given: 0 });
      }
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
    return regionStyle(geoRegion(this.world)).title || REAL_TITLE;
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
