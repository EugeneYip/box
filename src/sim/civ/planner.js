import { TILE, TILE_INFO, FLORA, FLORA_INFO, SEA_LEVEL } from '../../world/constants.js';
import { BUILDING_TYPES, costOf, canAfford, pay } from './catalog.js';
import { CULTURES, baseCulture } from './cultures.js';
import { USE, ROT, ROT_DIR, SPIRAL, spiralCount, clamp, lerp } from './util.js';
import { civPath } from './pathing.js';
import { FOOTPRINT } from '../../core/scale.js';

// Village distances follow FOOTPRINT (src/core/scale.js): the numbers below
// are design distances (round-13 tiles) passed through F / cells().
const F = FOOTPRINT.scale;
const cells = (d, min = 1) => FOOTPRINT.cells(d, min);
// site scoring looks at a circle of this radius round a new hall
const SITE_R = Math.max(7, cells(11));
const SITE_K = spiralCount(SITE_R) / spiralCount(11); // its area against round 13's
// field plots (tiles a side): small, tidy plots round a smaller village
const PLOT_SIZES = [
  [4, 3],
  [3, 4],
  [4, 4],
  [5, 3],
  [3, 5],
  [5, 4],
  [4, 5],
].map(([a, b]) => [cells(a, 2), cells(b, 2)]);

// Village planning: site scoring, building placement along streets, road
// growth, field plots, city walls and terrain levelling. Mixed into
// Civilization.prototype (so `this` is the Civilization).

// tile fertility by type (a realm's skills raise it for its settlers: breadth.js _fertTable)
const BASE_FERT = TILE_INFO.map((t) => t?.fertile ?? 0);
// Town Planning: cross streets every GRID tiles
const GRID = Math.max(3, cells(5));
// farm works kept beyond a Modern town's paving
const FARM_OUT = new Set(['granary', 'silo', 'pasture', 'barn']);
const FIELD_TYPES = new Set([TILE.GRASS, TILE.FOREST, TILE.SOIL, TILE.SAVANNA, TILE.JUNGLE, TILE.SWAMP, TILE.TUNDRA, TILE.FARMLAND, TILE.ASH]);

export const planner = {
  // ---------------------------------------------------------------- tiles
  _tileFree(i, allowTrees = true) {
    const w = this.world;
    if (w.height[i] < SEA_LEVEL + 0.05) return false;
    if (this.use[i] !== USE.FREE) return false;
    const t = w.type[i];
    const ti = TILE_INFO[t];
    if (!ti || !ti.walkable || !ti.buildable) return false;
    if (t === TILE.ROAD) return false;
    // never on a railway, a guideway's footing or a highway's strip (modern.js railMask)
    if (this.railMask?.[i]) return false;
    // nor in an airport's clear zone (modern.js airZone)
    if (this.airZone?.[i]) return false;
    const f = w.flora[i];
    if (f === FLORA.BOULDER) return false;
    if (!allowTrees && FLORA_INFO[f]?.isTree) return false;
    if (w.fire[i] > 0.05) return false;
    return true;
  },

  _footprintOK(tx, ty, fw, fh, maxSlope = 1.15, gap = true) {
    const w = this.world;
    if (tx < 2 || ty < 2 || tx + fw > w.w - 2 || ty + fh > w.h - 2) return false;
    let hmin = Infinity,
      hmax = -Infinity;
    for (let y = ty; y < ty + fh; y++)
      for (let x = tx; x < tx + fw; x++) {
        const i = y * w.w + x;
        if (!this._tileFree(i)) return false;
        const h = w.height[i];
        if (h < hmin) hmin = h;
        if (h > hmax) hmax = h;
      }
    if (hmax - hmin > maxSlope) return false;
    // the ground just round the plot counts too: a one-tile plot on a steep
    // slope always measured flat, and its house ended up on a rock pillar or
    // an office block overhung the slope on a single pole. The rise across
    // the plot and its ring may be at most about half a tile per tile.
    if (maxSlope < 5) {
      const lim = Math.min(maxSlope, 0.32 + 0.22 * Math.max(fw, fh)) + 0.25 + Math.max(0, maxSlope - 1.3) * 0.5;
      let rmin = hmin,
        rmax = hmax;
      for (let y = ty - 1; y <= ty + fh; y++)
        for (let x = tx - 1; x <= tx + fw; x++) {
          if (x >= tx && x < tx + fw && y >= ty && y < ty + fh) continue;
          if (!w.inBounds(x, y)) continue;
          const h = w.height[y * w.w + x];
          if (h < SEA_LEVEL) continue; // a shore or a jetty's water side
          if (h < rmin) rmin = h;
          if (h > rmax) rmax = h;
        }
      if (rmax - rmin > lim) return false;
    }
    if (gap) {
      for (let y = ty - 1; y <= ty + fh; y++)
        for (let x = tx - 1; x <= tx + fw; x++) {
          if (x >= tx && x < tx + fw && y >= ty && y < ty + fh) continue;
          if (!w.inBounds(x, y)) continue;
          if (this.use[y * w.w + x] === USE.BUILDING) return false;
        }
    }
    return true;
  },

  _footprintStats(tx, ty, fw, fh) {
    const w = this.world;
    let trees = 0,
      hmin = Infinity,
      hmax = -Infinity;
    for (let y = ty; y < ty + fh; y++)
      for (let x = tx; x < tx + fw; x++) {
        const i = y * w.w + x;
        if (FLORA_INFO[w.flora[i]]?.isTree) trees++;
        const h = w.height[i];
        if (h < hmin) hmin = h;
        if (h > hmax) hmax = h;
      }
    return { trees, slope: hmax - hmin };
  },

  // Level the ground under a footprint and ease the surrounding ring.
  _flatten(tx, ty, fw, fh, minH = SEA_LEVEL + 0.14) {
    const w = this.world;
    let sum = 0,
      n = 0;
    for (let y = ty; y < ty + fh; y++)
      for (let x = tx; x < tx + fw; x++) {
        sum += w.height[y * w.w + x];
        n++;
      }
    const target = Math.max(minH, sum / Math.max(1, n));
    for (let y = ty; y < ty + fh; y++) for (let x = tx; x < tx + fw; x++) w.height[y * w.w + x] = target;
    for (let ring = 1; ring <= 2; ring++) {
      const k = ring === 1 ? 0.7 : 0.3;
      for (let y = ty - ring; y < ty + fh + ring; y++)
        for (let x = tx - ring; x < tx + fw + ring; x++) {
          const onRing = x === tx - ring || y === ty - ring || x === tx + fw + ring - 1 || y === ty + fh + ring - 1;
          if (!onRing || !w.inBounds(x, y)) continue;
          const i = y * w.w + x;
          if (w.height[i] < SEA_LEVEL + 0.02) continue;
          if (this.use[i] === USE.BUILDING) continue;
          w.height[i] = Math.max(SEA_LEVEL + 0.03, lerp(w.height[i], target, k));
        }
    }
    w.markDirty('height', tx - 2, ty - 2, tx + fw + 1, ty + fh + 1);
    this._heightTouched(tx - 3, ty - 3, tx + fw + 2, ty + fh + 2);
    return target;
  },

  // Buildings near a terrain edit keep their foundation depth up to date.
  _heightTouched(x0, y0, x1, y1) {
    for (const b of this.buildings) {
      if (b.tx + b.w < x0 || b.tx > x1 || b.ty + b.h < y0 || b.ty > y1) continue;
      b.groundMin = this._groundMin(b);
    }
    this.version++;
  },

  _groundMin(b) {
    const w = this.world;
    let m = Infinity;
    const x0 = b.tx,
      z0 = b.ty,
      x1 = b.tx + b.w,
      z1 = b.ty + b.h;
    for (let k = 0; k <= 4; k++) {
      const fx = x0 + ((x1 - x0) * k) / 4,
        fz = z0 + ((z1 - z0) * k) / 4;
      m = Math.min(m, w.heightAt(fx, z0), w.heightAt(fx, z1), w.heightAt(x0, fz), w.heightAt(x1, fz));
    }
    return Math.min(m, b.y);
  },

  // ---------------------------------------------------------------- sites
  // Big maps (the World Map and its regions) hold the same people and about
  // the same number of villages as a Medium map on about eight times the
  // land. 0 on Medium and smaller maps, rising to 1 on the World Map's
  // regions (Huge World Map about 0.4).
  _bigMap() {
    const a = this.budget?.area ?? 1;
    return a <= 1.5 ? 0 : Math.min(1, (a - 1.5) / 3.5);
  },
  // How much further a big map's settlers go (1 on Medium): the village
  // budget covers the land instead of a few clusters (Europe held 14% of its
  // land at Year 100).
  _villageSpread() {
    return 1 + this._bigMap() * 0.4;
  },
  // How much further a village's territory reaches (1 on Medium).
  _territoryReach() {
    return 1 + this._bigMap() * 0.35;
  },

  // Score a potential village centre (hall centre tile). Returns -1 if unusable.
  _scoreSite(tx, ty, opts = {}) {
    const w = this.world;
    if (!this._footprintOK(tx - 1, ty - 1, 3, 3, 1.0)) return -1;
    if (tx < 14 || ty < 14 || tx > w.w - 14 || ty > w.h - 14) return -1;
    let space = 0,
      fert = 0,
      trees = 0,
      rocks = 0,
      water = 0,
      foreign = 0;
    const n = spiralCount(SITE_R);
    const nearR = SITE_R * (9 / 11);
    const FERT = this._fertTable(opts.kingdom, BASE_FERT); // a realm's skills open harsh land (breadth.js)
    for (let k = 0; k < n; k++) {
      const [dx, dy, d] = SPIRAL[k];
      const x = tx + dx,
        y = ty + dy;
      if (!w.inBounds(x, y)) continue;
      const i = y * w.w + x;
      if (w.height[i] < SEA_LEVEL) {
        if (d <= nearR) water++;
        continue;
      }
      const t = w.type[i];
      const f = w.flora[i];
      if (TILE_INFO[t].buildable && TILE_INFO[t].walkable && this.use[i] === USE.FREE && w.slopeAt(x, y) < 1.0 && f !== FLORA.BOULDER) {
        space++;
        fert += FERT[t];
      }
      if (FLORA_INFO[f]?.isTree) trees++;
      if (f === FLORA.BOULDER || f === FLORA.ROCK_SMALL || t === TILE.ROCK) rocks++;
      if (opts.kingdom != null && w.owner[i] >= 0 && w.owner[i] !== opts.kingdom) foreign++;
      else if (opts.kingdom == null && w.owner[i] >= 0) foreign++;
    }
    if (space < (opts.minSpace ?? 120) * SITE_K) return -1;
    if (foreign > 30 * SITE_K) return -1;
    let s = (space * 1.0 + fert * 0.7 + Math.min(trees, 50 * SITE_K) * 0.6 + Math.min(rocks, 16 * SITE_K) * 1.6) / SITE_K;
    if (water > 2) s += 24;
    if (water > 120 * SITE_K) s -= ((water - 120 * SITE_K) * 0.6) / SITE_K;
    s -= (foreign * 3) / SITE_K;
    return s;
  },

  // Pick n spread-out sites for the starting villages.
  _pickStartSites(n) {
    const w = this.world;
    const rng = this.rng;
    const cands = [];
    const scale = Math.sqrt((w.w * w.h) / (256 * 256));
    const step = Math.max(5, Math.round(5 * scale));
    for (let y = 16; y < w.h - 16; y += step)
      for (let x = 16; x < w.w - 16; x += step) {
        const tx = x + rng.int(-2, 2),
          ty = y + rng.int(-2, 2);
        const s = this._scoreSite(tx, ty);
        if (s > 0) cands.push({ tx, ty, s, culture: this._cultureAt(tx, ty), land: this.landId[ty * w.w + tx] });
      }
    cands.sort((a, b) => b.s - a.s);
    const chosen = [];
    const usedCultures = new Map();
    let minD = (n <= 3 ? 64 : n <= 5 ? 50 : 36) * Math.max(1, Math.sqrt((w.w * w.h) / (256 * 256)) * (n <= 3 ? 1 : 0.95));
    // prefer the largest landmasses so kingdoms can meet over land
    const landSize = this._landSizes;
    while (chosen.length < n && minD >= 14) {
      let best = null,
        bs = -Infinity;
      for (const c of cands) {
        if (chosen.some((o) => (o.tx - c.tx) ** 2 + (o.ty - c.ty) ** 2 < minD * minD)) continue;
        if (w.meta?.spreadStarts && c.culture === 'frost') continue; // World Map: no starts on the ice sheets
        let s = c.s;
        const uses = usedCultures.get(c.culture) || 0;
        s *= uses === 0 ? 1.25 : 1 / (1 + uses * 0.25);
        const ls = landSize.get(c.land) || 0;
        s *= 0.5 + 0.5 * Math.min(1, ls / 3000);
        // spread: reward distance to the nearest chosen site (but not too far)
        if (chosen.length) {
          let md = Infinity;
          for (const o of chosen) md = Math.min(md, Math.hypot(o.tx - c.tx, o.ty - c.ty));
          s *= 1 + Math.min(md, 110) / 400;
          // rivals should share a continent so they can meet, trade and fight;
          // on the World Map (world.meta.spreadStarts) they settle every continent
          if (w.meta?.spreadStarts) {
            if (!chosen.some((o) => o.land === c.land) && (landSize.get(c.land) || 0) > 1500) s *= 1.5;
          } else if (c.land === chosen[0].land && (landSize.get(c.land) || 0) > 2500) s *= 1.6;
        }
        if (s > bs) {
          bs = s;
          best = c;
        }
      }
      if (!best) {
        minD *= 0.75;
        continue;
      }
      chosen.push(best);
      usedCultures.set(best.culture, (usedCultures.get(best.culture) || 0) + 1);
    }
    return chosen;
  },

  _cultureAt(tx, ty) {
    const w = this.world;
    const score = { vale: 0, dune: 0, frost: 0, mire: 0 };
    const n = spiralCount(8);
    for (let k = 0; k < n; k++) {
      const [dx, dy] = SPIRAL[k];
      const x = tx + dx,
        y = ty + dy;
      if (!w.inBounds(x, y)) continue;
      const i = y * w.w + x;
      if (w.height[i] < SEA_LEVEL) continue;
      const t = w.type[i];
      const temp = w.temperature[i],
        moist = w.moisture[i];
      if (t === TILE.TUNDRA || t === TILE.SNOW) score.frost += 1.5;
      if (t === TILE.DESERT) score.dune += 1.6;
      if (t === TILE.SAVANNA) score.dune += 1.1;
      if (t === TILE.SWAMP) score.mire += 2.2;
      if (t === TILE.JUNGLE) score.mire += 1.6;
      if (t === TILE.GRASS || t === TILE.FOREST) score.vale += 1.0;
      if (temp < 0.36) score.frost += 0.7;
      if (temp > 0.72 && moist < 0.5) score.dune += 0.6;
      if (temp > 0.6 && moist > 0.65) score.mire += 0.5;
    }
    let best = 'vale',
      bv = 0;
    for (const k in score)
      if (score[k] > bv) {
        bv = score[k];
        best = k;
      }
    return best;
  },

  // Find the nearest valid hall position (top-left) around a tile.
  // radius of the paving the terrain draws round an Industrial or later town
  // (Terrain._writeSettle uses the same figure)
  _pavedRadius(v) {
    return Math.max(5, (v.buildRadius || v.radius || 6) * 1.15 + 2);
  },

  _hallSpotNear(tx, ty, maxR = 7) {
    const n = spiralCount(maxR);
    for (let k = 0; k < n; k++) {
      const [dx, dy] = SPIRAL[k];
      const x = tx + dx - 1,
        y = ty + dy - 1;
      if (this._footprintOK(x, y, 3, 3, 1.3)) return [x, y];
    }
    return null;
  },

  // ---------------------------------------------------------------- buildings
  addBuilding(v, type, tx, ty, rot, opts = {}) {
    const def = BUILDING_TYPES[type];
    const w = this.world;
    const fw = rot & 1 ? def.h : def.w;
    const fh = rot & 1 ? def.w : def.h;
    const level = opts.level || 1;
    const maxHp = def.hp[level - 1] ?? def.hp[0];
    // clear vegetation (felled trees go to the village store)
    for (let y = ty; y < ty + fh; y++)
      for (let x = tx; x < tx + fw; x++) {
        const i = y * w.w + x;
        const f = w.flora[i];
        if (f) {
          if (FLORA_INFO[f]?.isTree) v.wood += Math.max(1, FLORA_INFO[f].wood >> 1);
          w.setFlora(x, y, FLORA.NONE);
        }
        if (w.type[i] === TILE.FARMLAND) w.setType(x, y, TILE.SOIL);
      }
    const y = opts.noFlatten ? w.height[ty * w.w + tx] : this._flatten(tx, ty, fw, fh, type === 'docks' ? SEA_LEVEL + 0.2 : SEA_LEVEL + 0.14);
    const r = ROT[rot];
    const [ddx, ddz] = ROT_DIR[rot];
    const b = {
      id: this._nextBid++,
      type,
      kind: def.kind || type, // the renderer's model key (modern types share placeholders until modelled)
      tx,
      ty,
      w: fw,
      h: fh,
      x: tx + fw / 2,
      z: ty + fh / 2,
      y,
      groundMin: y,
      rotation: r,
      rot,
      kingdom: v.kingdom,
      village: v.id,
      level,
      progress: opts.complete ? 1 : opts.progress ?? 0,
      constructing: !opts.complete,
      upgrading: false,
      upgradeProgress: 0,
      hp: opts.complete ? maxHp : Math.max(10, maxHp * 0.3),
      maxHp,
      burning: 0,
      alive: true,
      ruin: false,
      style: CULTURES[baseCulture(v.culture)]?.style || 'vale',
      era: this.kingdoms[v.kingdom]?.era ?? 0,
      culture: v.culture,
      seed: this.rng.next(),
      builtAt: this.game.time.total,
      doorX: tx + fw / 2 + ddx * (def.h / 2 + 0.45),
      doorZ: ty + fh / 2 + ddz * (def.h / 2 + 0.45),
      builders: 0,
    };
    for (let yy = ty; yy < ty + fh; yy++)
      for (let xx = tx; xx < tx + fw; xx++) {
        const i = yy * w.w + xx;
        this.use[i] = USE.BUILDING;
        w.building[i] = b.id;
      }
    b.groundMin = this._groundMin(b);
    this.buildings.push(b);
    this._bById.set(b.id, b);
    v.buildings.push(b);
    if (type === 'hall') v.hall = b;
    this.version++;
    return b;
  },

  // Try to place a building of `type` fronting one of the village's streets.
  placeAlongRoad(v, type, scoreBias = null) {
    const def = BUILDING_TYPES[type];
    const w = this.world;
    const W = w.w;
    // the town's plan (a main street and its cross streets) is laid before
    // the houses fill in, and laid out further as it becomes a town
    this._layTownPlan(v);
    // from the Modern era the farm works (silos, granaries, barns, pens)
    // stand out beyond the paved town, never in its square or core
    if (FARM_OUT.has(type) && (this.kingdoms[v.kingdom]?.era || 0) >= 5) {
      const rp = this._pavedRadius(v);
      return this._placeOutskirts(v, type, rp + 0.5, rp + 5);
    }
    const roads = v.roadTiles;
    if (!roads.length) return null;
    const rng = this.rng;
    const limit = 220;
    let best = null,
      bestS = Infinity;
    const hx = v.cx,
      hz = v.cz;
    const maxR = v.buildRadius + FOOTPRINT.dist(2);
    // a modern city's homes stand shoulder to shoulder along its streets
    // (they were a thin sprinkle with a gap all round each one)
    const dense = v.tier >= 2 && (this.kingdoms[v.kingdom]?.era || 0) >= 5 && (type === 'house' || type === 'apartment' || type === 'rowhouse');
    for (let k = 0; k < Math.min(roads.length, limit); k++) {
      const r = roads.length <= limit ? roads[k] : roads[(rng.next() * roads.length) | 0];
      if (this.use[r] !== USE.ROAD) continue;
      const rx = r % W,
        ry = (r / W) | 0;
      if ((rx + 0.5 - hx) ** 2 + (ry + 0.5 - hz) ** 2 > maxR * maxR) continue;
      for (let s = 0; s < 4; s++) {
        const [sx, sz] = ROT_DIR[s];
        const rot = (s + 2) & 3;
        const fw = rot & 1 ? def.h : def.w,
          fh = rot & 1 ? def.w : def.h;
        let tx0, ty0;
        if (sz === 1) {
          ty0 = ry + 1;
          tx0 = rx - ((fw - 1) >> 1);
        } else if (sz === -1) {
          ty0 = ry - fh;
          tx0 = rx - ((fw - 1) >> 1);
        } else if (sx === 1) {
          tx0 = rx + 1;
          ty0 = ry - ((fh - 1) >> 1);
        } else {
          tx0 = rx - fw;
          ty0 = ry - ((fh - 1) >> 1);
        }
        if (!this._footprintOK(tx0, ty0, fw, fh, 1.15, !dense)) continue;
        const st = this._footprintStats(tx0, ty0, fw, fh);
        const cx = tx0 + fw / 2,
          cz = ty0 + fh / 2;
        let score = Math.hypot(cx - hx, cz - hz) + st.slope * 3 + st.trees * 0.35 + rng.next() * 1.2;
        // keep road tips open so streets can keep growing
        if (this._blocksTip(tx0, ty0, fw, fh)) score += 6;
        if (scoreBias) score += scoreBias(cx, cz, tx0, ty0, fw, fh);
        if (score < bestS) {
          bestS = score;
          best = { tx: tx0, ty: ty0, rot };
        }
      }
    }
    if (!best) return null;
    return this.addBuilding(v, type, best.tx, best.ty, best.rot);
  },

  _blocksTip(tx, ty, fw, fh) {
    const w = this.world;
    for (let y = ty - 1; y <= ty + fh; y++)
      for (let x = tx - 1; x <= tx + fw; x++) {
        if (!w.inBounds(x, y)) continue;
        const i = y * w.w + x;
        if (this.use[i] !== USE.ROAD) continue;
        if (this._roadNeighbours(x, y) <= 1) {
          // tip: is the footprint in its continuation?
          return true;
        }
      }
    return false;
  },

  _roadNeighbours(x, y) {
    const w = this.world;
    let n = 0;
    for (const [dx, dy] of ROT_DIR) {
      const xx = x + dx,
        yy = y + dy;
      if (w.inBounds(xx, yy) && this.use[yy * w.w + xx] === USE.ROAD) n++;
    }
    return n;
  },

  // ---------------------------------------------------------------- roads
  layRoad(v, i) {
    const w = this.world;
    if (w.height[i] < SEA_LEVEL) return false;
    const u = this.use[i];
    if (u === USE.BUILDING || u === USE.RUIN) return false;
    if (u === USE.PLOT) this._removePlotTile(i);
    if (u !== USE.ROAD) {
      this.use[i] = USE.ROAD;
      if (v) v.roadTiles.push(i);
    }
    const x = i % w.w,
      y = (i / w.w) | 0;
    if (w.flora[i]) {
      if (v && FLORA_INFO[w.flora[i]]?.isTree) v.wood += 1;
      w.setFlora(x, y, FLORA.NONE);
    }
    // with the roads law off, streets stay as worn paths rather than paving
    if (this.law ? this.law('civRoads') : true) w.setType(x, y, TILE.ROAD);
    return true;
  },

  _roadOK(x, y) {
    const w = this.world;
    if (!w.inBounds(x, y) || x < 2 || y < 2 || x >= w.w - 2 || y >= w.h - 2) return false;
    const i = y * w.w + x;
    if (w.height[i] < SEA_LEVEL + 0.05) return false;
    const u = this.use[i];
    if (u !== USE.FREE && u !== USE.ROAD) return false;
    const t = w.type[i];
    if (!TILE_INFO[t].walkable || t === TILE.ROCK || t === TILE.ICE || t === TILE.LAVA) return false;
    if (w.flora[i] === FLORA.BOULDER) return false;
    return true;
  },

  // Lay a straight street from (x,y) in direction (dx,dy). Returns tiles laid.
  _street(v, x, y, dx, dy, len) {
    const w = this.world;
    let laid = 0;
    let ph = w.getHeight(x, y);
    for (let k = 0; k < len; k++) {
      const xx = x + dx * k,
        yy = y + dy * k;
      if (!this._roadOK(xx, yy)) break;
      const h = w.getHeight(xx, yy);
      if (Math.abs(h - ph) > 0.9) break;
      ph = h;
      this.layRoad(v, yy * w.w + xx);
      laid++;
    }
    return laid;
  },

  // Grow the street network outward from a tip or branch off a straight run.
  _extendRoads(v) {
    const w = this.world;
    const W = w.w;
    const rng = this.rng;
    const maxR = v.buildRadius;
    const cands = [];
    const roads = v.roadTiles;
    const grid = this._gridPlan(v);
    const sample = roads.length > 160 ? 160 : roads.length;
    for (let k = 0; k < sample; k++) {
      const r = roads.length > 160 ? roads[(rng.next() * roads.length) | 0] : roads[k];
      if (this.use[r] !== USE.ROAD) continue;
      const x = r % W,
        y = (r / W) | 0;
      const nb = [];
      for (let d = 0; d < 4; d++) {
        const [dx, dy] = ROT_DIR[d];
        if (w.inBounds(x + dx, y + dy) && this.use[(y + dy) * W + x + dx] === USE.ROAD) nb.push(d);
      }
      if (nb.length === 1) {
        // a street grows on straight from its end (turning at the tip drew
        // stair-step zigzags and a maze of dead ends)
        cands.push({ x, y, d: (nb[0] + 2) & 3, tip: true });
      } else if (nb.length === 2 && ((nb[0] + 2) & 3) === nb[1]) {
        cands.push({ x, y, d: (nb[0] + 1) & 3, tip: false });
        cands.push({ x, y, d: (nb[0] + 3) & 3, tip: false });
      }
    }
    let best = null,
      bs = -Infinity;
    for (const c of cands) {
      const [dx, dy] = ROT_DIR[c.d];
      const len = cells(6, 3) + ((rng.next() * cells(3, 1)) | 0);
      let ok = 0;
      let room = 0;
      let ph = w.getHeight(c.x, c.y);
      let bad = false;
      for (let k = 1; k <= len; k++) {
        const x = c.x + dx * k,
          y = c.y + dy * k;
        if (!this._roadOK(x, y)) break;
        if (Math.hypot(x + 0.5 - v.cx, y + 0.5 - v.cz) > maxR) break;
        const h = w.getHeight(x, y);
        if (Math.abs(h - ph) > 0.8) break;
        ph = h;
        if (this.use[y * W + x] === USE.ROAD) break;
        // keep parallel streets apart so houses fit between them
        if (k >= 2) {
          for (let o = -3; o <= 3; o++) {
            if (!o) continue;
            const sx = x + dy * o,
              sy = y + dx * o;
            if (w.inBounds(sx, sy) && this.use[sy * W + sx] === USE.ROAD) bad = true;
          }
        }
        if (bad) break;
        // room for houses on each side
        for (let o = 1; o <= 2; o++) {
          for (const sgn of [-1, 1]) {
            const sx = x + dy * o * sgn,
              sy = y + dx * o * sgn;
            if (w.inBounds(sx, sy) && this._tileFree(sy * W + sx)) room++;
          }
        }
        ok = k;
      }
      if (ok < 3) continue;
      const ex = c.x + dx * ok,
        ey = c.y + dy * ok;
      const outward = Math.hypot(ex - v.cx, ey - v.cz) - Math.hypot(c.x - v.cx, c.y - v.cz);
      let s = room + ok * 0.5 + outward * 0.8 + (c.tip ? 4 : 0) - (c.turn ? 2 : 0) + rng.next() * 4;
      // Town Planning: cross streets every few tiles off a straight run (grid blocks)
      if (grid && !c.tip) s += ((dx ? c.y : c.x) % GRID === 0 ? 7 : -3);
      if (s > bs) {
        bs = s;
        best = { ...c, len: ok };
      }
    }
    this._pruneStubs(v);
    if (!best) return false;
    const [dx, dy] = ROT_DIR[best.d];
    const laid = this._street(v, best.x + dx, best.y + dy, dx, dy, best.len);
    if (grid && !best.tip && laid >= 3 && ((dx ? best.y : best.x) % GRID === 0)) this._firstUse(this.kingdoms[v.kingdom], 'gridstreets', { x: best.x, z: best.y });
    this.fieldVersion++;
    return true;
  },

  // The town plan: a main street along the hall front, run out to the edge
  // of the build area, with cross streets every few tiles along it (a comb
  // of blocks two plots deep). Phase 1 at founding, phase 2 (further out,
  // more cross streets) once the village is a town or modern.
  _layTownPlan(v) {
    const h = v.hall;
    if (!h || h.alive === false) return;
    const era = this.kingdoms[v.kingdom]?.era || 0;
    const want = 1 + (v.tier >= 1 || era >= 4 ? 1 : 0) + (v.tier >= 2 ? 1 : 0);
    if ((v.planPhase || 0) >= want) return;
    v.planPhase = want;
    const w = this.world;
    const [dx, dz] = ROT_DIR[h.rot ?? 0];
    const hx = h.tx + (h.w >> 1),
      hy = h.ty + (h.h >> 1);
    // the main street runs across the hall front, two tiles out from its centre
    const off = Math.ceil(Math.max(h.w, h.h) / 2);
    const fx = hx + dx * off,
      fy = hy + dz * off;
    const px = dz,
      pz = dx;
    const R = Math.max(cells(9, 5), Math.round((v.buildRadius || 6) * (want >= 2 ? 0.95 : 0.7)));
    const mainA = this._street(v, fx, fy, px, pz, R + 1);
    const mainB = this._street(v, fx - px, fy - pz, -px, -pz, R);
    // cross streets every SPACE tiles along it, both ways from the main street
    const SPACE = 3;
    const nCross = want === 1 ? 1 : want === 2 ? 3 : 5;
    const crossLen = Math.max(cells(6, 3), Math.round(R * (want >= 2 ? 0.8 : 0.55)));
    let made = 0;
    for (let k = 1; k <= 8 && made < nCross * 2; k++) {
      for (const sg of [1, -1]) {
        const reach = sg > 0 ? mainA : mainB + 1;
        const o = k * SPACE;
        if (o >= reach) continue;
        const sx = fx + px * o * sg,
          sy = fy + pz * o * sg;
        if (!w.inBounds(sx, sy) || this.use[sy * w.w + sx] !== USE.ROAD) continue;
        const a = this._street(v, sx + dx, sy + dz, dx, dz, crossLen);
        const b = this._street(v, sx - dx, sy - dz, -dx, -dz, crossLen);
        if (a + b >= 3) made++;
      }
    }
    // a street behind the hall, parallel to the main one, ties the comb into blocks
    if (want >= 2) {
      const bo = SPACE + 1;
      const bx = hx - dx * bo,
        by = hy - dz * bo;
      if (w.inBounds(bx, by) && this._roadOK(bx, by)) {
        this._street(v, bx, by, px, pz, Math.round(R * 0.7));
        this._street(v, bx - px, by - pz, -px, -pz, Math.round(R * 0.7));
      }
      const ax = fx + dx * SPACE,
        ay = fy + dz * SPACE;
      if (w.inBounds(ax, ay) && this._roadOK(ax, ay)) {
        this._street(v, ax, ay, px, pz, Math.round(R * 0.8));
        this._street(v, ax - px, ay - pz, -px, -pz, Math.round(R * 0.8));
      }
    }
    this._pruneStubs(v, true);
    this.fieldVersion++;
  },

  // Dead-end spurs shorter than two tiles that lead to no door are taken up
  // again (a maze of tile-wide stubs grew where streets met at odd angles).
  _pruneStubs(v, force = false) {
    const now = this.game.time.total;
    if (!force && now - (v.stubT ?? -1e9) < 20) return 0;
    v.stubT = now;
    const w = this.world;
    const W = w.w;
    const doors = new Set();
    for (const b of v.buildings) {
      if (!b.alive) continue;
      const t = this._doorTile(b);
      if (t) doors.add(t[1] * W + t[0]);
    }
    const hall = v.hall;
    const hdx = hall ? Math.floor(hall.doorX) : -99,
      hdz = hall ? Math.floor(hall.doorZ) : -99;
    const isR = (x, y) => w.inBounds(x, y) && this.use[y * W + x] === USE.ROAD;
    let removed = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (const i of v.roadTiles) {
        if (this.use[i] !== USE.ROAD || doors.has(i)) continue;
        if (w.building[i] >= 0) continue; // a bridge deck or a gate
        const x = i % W,
          y = (i / W) | 0;
        if (Math.abs(x - hdx) <= 2 && Math.abs(y - hdz) <= 2) continue; // the square
        const nb = [];
        for (const [ox, oy] of ROT_DIR) if (isR(x + ox, y + oy)) nb.push([x + ox, y + oy]);
        if (nb.length > 1) continue;
        // a door may face this tile from beside it
        let door = false;
        for (const [ox, oy] of ROT_DIR) if (doors.has((y + oy) * W + x + ox)) door = true;
        if (door) continue;
        // diagonal road neighbours must all belong to the junction it hangs off
        let diag = false;
        for (const [ox, oy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          if (!isR(x + ox, y + oy)) continue;
          if (!nb.length) diag = true;
          else {
            const [nx, ny] = nb[0];
            if (Math.abs(x + ox - nx) + Math.abs(y + oy - ny) !== 1) diag = true;
          }
        }
        if (diag) continue;
        if (nb.length === 1) {
          // a spur: only when the tile it hangs off is a junction or a run
          // across it (so the end of a real street is kept)
          const [nx, ny] = nb[0];
          let m = 0;
          for (const [ox, oy] of ROT_DIR) if (isR(nx + ox, ny + oy)) m++;
          if (m < 3) continue;
        }
        this._unlayRoad(i);
        removed++;
      }
    }
    if (removed) {
      v.roadTiles = v.roadTiles.filter((i) => this.use[i] === USE.ROAD);
      this.fieldVersion++;
    }
    return removed;
  },

  _unlayRoad(i) {
    const w = this.world;
    const W = w.w;
    const x = i % W,
      y = (i / W) | 0;
    this.use[i] = USE.FREE;
    if (w.type[i] !== TILE.ROAD) return;
    // the ground returns as what is round it (grass by default)
    const cnt = new Map();
    for (let oy = -1; oy <= 1; oy++)
      for (let ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        if (!w.inBounds(x + ox, y + oy)) continue;
        const t = w.type[(y + oy) * W + x + ox];
        if (t === TILE.ROAD || t === TILE.FARMLAND || !TILE_INFO[t]?.walkable || !TILE_INFO[t]?.buildable) continue;
        cnt.set(t, (cnt.get(t) || 0) + 1);
      }
    let bt = TILE.GRASS,
      bn = 0;
    for (const [t, c] of cnt) if (c > bn) (bn = c), (bt = t);
    w.setType(x, y, bt);
  },

  _roadCost() {
    if (this.__roadCost) return this.__roadCost;
    const w = this.world;
    this.__roadCost = (i) => {
      if (w.height[i] < SEA_LEVEL + 0.03) return Infinity;
      const t = w.type[i];
      if (!TILE_INFO[t].walkable || t === TILE.LAVA || t === TILE.ICE) return Infinity;
      const u = this.use[i];
      if (u === USE.BUILDING) {
        const b = this._bById.get(w.building[i]);
        return b && b.type === 'gate' ? 0.4 : Infinity;
      }
      if (u === USE.ROAD) return 0.4;
      // an airport's clear zone: no street off a runway's end, dear beside it
      const az = this.airZone?.[i];
      if (az === 2) return Infinity;
      if (u === USE.RUIN) return 5;
      if (u === USE.PLOT) return 4;
      if (w.flora[i] === FLORA.BOULDER) return Infinity;
      let c = 1;
      if (t === TILE.ROCK) c += 2.5;
      if (t === TILE.SWAMP) c += 0.8;
      if (FLORA_INFO[w.flora[i]]?.isTree) c += 0.6;
      const x = i % w.w,
        y = (i / w.w) | 0;
      c += w.slopeAt(x, y) * 1.4;
      if (az === 1) c += 8;
      return c;
    };
    return this.__roadCost;
  },

  // Connect a tile to the village street network with a laid road.
  _connectToRoads(v, x, y, maxNodes = 2500) {
    const w = this.world;
    const W = w.w;
    const start = y * W + x;
    if (this.use[start] === USE.ROAD) return true;
    const cost = this._roadCost();
    const p = civPath(w, x, y, Math.floor(v.cx), Math.floor(v.cz), cost, maxNodes, 0.4, (i) => this.use[i] === USE.ROAD);
    if (!p) return false;
    // stop where the path meets the network, then lay it as straight runs
    const run = [start];
    for (const i of p) {
      run.push(i);
      if (this.use[i] === USE.ROAD) break;
    }
    for (const i of this._straightPath(run)) {
      const u = this.use[i];
      if (u === USE.FREE || u === USE.PLOT) this.layRoad(v, i);
    }
    return true;
  },

  // A path from civPath steps diagonally, and laid tile by tile that drew a
  // stair-step of square pads that touched only at their corners. This lays
  // it as a few straight runs instead: from each corner it reaches as far
  // along the path as an L of open, gently sloping ground allows (each
  // diagonal step at least gets a corner tile, so the street is continuous).
  _straightPath(path) {
    const w = this.world;
    const W = w.w;
    const n = path.length;
    if (n < 2) return path.slice();
    const okTile = (i) => {
      const u = this.use[i];
      if (u === USE.ROAD) return true;
      if (u !== USE.FREE && u !== USE.PLOT) return false;
      if (w.height[i] < SEA_LEVEL + 0.05) return false;
      const t = w.type[i];
      if (!TILE_INFO[t]?.walkable || t === TILE.LAVA || t === TILE.ICE) return false;
      if (w.flora[i] === FLORA.BOULDER) return false;
      if (this.railMask?.[i]) return false;
      if (this.airZone?.[i]) return false;
      return true;
    };
    // the tiles of an L from a to b (first along x when xFirst), or null
    const lRoute = (a, b, xFirst) => {
      const ax = a % W,
        ay = (a / W) | 0,
        bx = b % W,
        by = (b / W) | 0;
      const out = [];
      let x = ax,
        y = ay,
        ph = w.height[a];
      const step = (nx, ny) => {
        const i = ny * W + nx;
        if (!okTile(i)) return false;
        const h = w.height[i];
        if (Math.abs(h - ph) > 0.7) return false;
        ph = h;
        out.push(i);
        return true;
      };
      const sx = Math.sign(bx - ax),
        sy = Math.sign(by - ay);
      if (xFirst) {
        while (x !== bx) if (!step((x += sx), y)) return null;
        while (y !== by) if (!step(x, (y += sy))) return null;
      } else {
        while (y !== by) if (!step(x, (y += sy))) return null;
        while (x !== bx) if (!step((x += sx), y)) return null;
      }
      return out;
    };
    const res = [path[0]];
    let a = 0;
    while (a < n - 1) {
      let bestJ = -1,
        bestR = null;
      for (let j = Math.min(n - 1, a + 28); j > a; j--) {
        const pa = path[a],
          pb = path[j];
        const dx = Math.abs((pb % W) - (pa % W)),
          dy = Math.abs(((pb / W) | 0) - ((pa / W) | 0));
        const r = lRoute(pa, pb, dx >= dy) || lRoute(pa, pb, dx < dy);
        if (r) {
          bestJ = j;
          bestR = r;
          break;
        }
      }
      if (bestJ < 0) {
        // no open L even to the next tile: keep the step, with a corner tile
        const pa = path[a],
          pb = path[a + 1];
        const ax = pa % W,
          ay = (pa / W) | 0,
          bx = pb % W,
          by = (pb / W) | 0;
        if (ax !== bx && ay !== by) {
          const c1 = ay * W + bx,
            c2 = by * W + ax;
          if (okTile(c1)) res.push(c1);
          else if (okTile(c2)) res.push(c2);
        }
        res.push(pb);
        a++;
        continue;
      }
      for (const i of bestR) res.push(i);
      a = bestJ;
    }
    return res;
  },

  // Long road between two villages (trade route).
  connectVillages(a, b, maxNodes = 40000) {
    const w = this.world;
    const W = w.w;
    const sa = this._doorTile(a.hall),
      sb = this._doorTile(b.hall);
    if (!sa || !sb) return false;
    const cost = this._roadCost();
    const p = civPath(w, sa[0], sa[1], sb[0], sb[1], cost, maxNodes, 0.4);
    if (!p) return false;
    const last = p[p.length - 1];
    if (Math.hypot((last % W) - sb[0], ((last / W) | 0) - sb[1]) > 3) return false;
    a.tradeLinks = (a.tradeLinks || 0) + 1;
    b.tradeLinks = (b.tradeLinks || 0) + 1;
    const sp = this._straightPath([sa[1] * W + sa[0], ...p]);
    const mid = (sp.length / 2) | 0;
    for (let k = 0; k < sp.length; k++) {
      const i = sp[k];
      const u = this.use[i];
      if (u === USE.BUILDING || u === USE.RUIN) continue;
      this.layRoad(k < mid ? a : b, i);
    }
    return true;
  },

  _doorTile(b) {
    if (!b) return null;
    const w = this.world;
    const x = Math.floor(b.doorX),
      y = Math.floor(b.doorZ);
    if (!w.inBounds(x, y)) return null;
    return [x, y];
  },

  // ---------------------------------------------------------------- fields
  _fieldTypeOK(v, i) {
    const w = this.world;
    const t = w.type[i];
    if (FIELD_TYPES.has(t)) return true;
    const base = baseCulture(v.culture);
    if (base === 'dune' && (t === TILE.SAND || t === TILE.DESERT)) return true;
    if (base === 'frost' && t === TILE.SNOW) return true;
    return this._fieldBiomeOK(v, t); // qanats, cold building (breadth.js)
  },

  _planPlot(v) {
    const w = this.world;
    const W = w.w;
    const rng = this.rng;
    const sizes = PLOT_SIZES;
    // a city (tier 2+) keeps its fields beyond its core, round the outskirts
    const minD = v.tier >= 2 ? Math.max((4 + v.tier) * F + 1.5, v.radius * 0.8) : (4 + v.tier) * F + 1.5;
    const maxD = Math.max(v.buildRadius + 11 * F, minD + 6);
    const steep = this._terraceSlope(v); // Terracing (breadth.js)
    let best = null,
      bs = Infinity;
    for (let k = 0; k < 90; k++) {
      let ax, ay;
      const [sw, sh] = sizes[(rng.next() * sizes.length) | 0];
      if (v.plots.length && rng.chance(0.6)) {
        // beside an earlier plot, a one-tile path between them
        const p = v.plots[(rng.next() * v.plots.length) | 0];
        const side = rng.int(0, 3);
        const [pw, ph] = [p.x1 - p.x0 + 1, p.y1 - p.y0 + 1];
        if (side === 0) {
          ax = p.x1 + 2;
          ay = p.y0 + rng.int(-1, ph - 1);
        } else if (side === 1) {
          ax = p.x0 - 1 - sw;
          ay = p.y0 + rng.int(-1, ph - 1);
        } else if (side === 2) {
          ax = p.x0 + rng.int(-1, pw - 1);
          ay = p.y1 + 2;
        } else {
          ax = p.x0 + rng.int(-1, pw - 1);
          ay = p.y0 - 1 - sh;
        }
      } else {
        const a = rng.float(0, Math.PI * 2),
          r = rng.float(minD, maxD);
        ax = Math.floor(v.cx + Math.cos(a) * r);
        ay = Math.floor(v.cz + Math.sin(a) * r);
      }
      const x0 = ax,
        y0 = ay;
      if (x0 < 3 || y0 < 3 || x0 + sw > w.w - 3 || y0 + sh > w.h - 3) continue;
      const cx = x0 + sw / 2,
        cy = y0 + sh / 2;
      const d = Math.hypot(cx - v.cx, cy - v.cz);
      if (d < minD || d > maxD + 3 * F) continue;
      let ok = true,
        trees = 0,
        fert = 0,
        hmin = Infinity,
        hmax = -Infinity;
      for (let y = y0; y < y0 + sh && ok; y++)
        for (let x = x0; x < x0 + sw; x++) {
          const i = y * W + x;
          if (!this._tileFree(i) || !this._fieldTypeOK(v, i)) {
            ok = false;
            break;
          }
          if (w.owner[i] >= 0 && w.owner[i] !== v.kingdom) {
            ok = false;
            break;
          }
          if (FLORA_INFO[w.flora[i]]?.isTree) trees++;
          fert += TILE_INFO[w.type[i]].fertile;
          const h = w.height[i];
          hmin = Math.min(hmin, h);
          hmax = Math.max(hmax, h);
        }
      if (!ok || hmax - hmin > steep) continue;
      // keep a path-wide gap from buildings
      let adjPlot = 0,
        adjRoad = 0;
      for (let y = y0 - 1; y <= y0 + sh && ok; y++)
        for (let x = x0 - 1; x <= x0 + sw; x++) {
          if (x >= x0 && x < x0 + sw && y >= y0 && y < y0 + sh) continue;
          if (!w.inBounds(x, y)) continue;
          const u = this.use[y * W + x];
          if (u === USE.BUILDING) {
            ok = false;
            break;
          }
          if (u === USE.PLOT) {
            ok = false; // plots are separated by a one-tile path
            break;
          }
          if (u === USE.ROAD) adjRoad++;
        }
      if (!ok) continue;
      for (let y = y0 - 2; y <= y0 + sh + 1; y++)
        for (let x = x0 - 2; x <= x0 + sw + 1; x++) if (w.inBounds(x, y) && this.use[y * W + x] === USE.PLOT) adjPlot++;
      const n = sw * sh;
      const s = d * 1.0 + trees * 1.3 + (1 - fert / n) * 8 - Math.min(adjPlot, 6) * 0.9 - Math.min(adjRoad, 4) * 0.6 + rng.next() * 2;
      if (s < bs) {
        bs = s;
        best = { x0, y0, x1: x0 + sw - 1, y1: y0 + sh - 1, slope: hmax - hmin };
      }
    }
    if (!best) return null;
    const slope = best.slope;
    delete best.slope;
    const plot = { id: this._nextPlot++, village: v.id, ...best, tiles: [] };
    for (let y = best.y0; y <= best.y1; y++)
      for (let x = best.x0; x <= best.x1; x++) {
        const i = y * W + x;
        this.use[i] = USE.PLOT;
        this.plotOf[i] = v.id;
        plot.tiles.push(i);
      }
    v.plots.push(plot);
    v.fieldCount += plot.tiles.length;
    this._plotBiome(v, plot, slope);
    this.fieldVersion++;
    return plot;
  },

  _removePlotTile(i) {
    const vid = this.plotOf[i];
    this.plotOf[i] = -1;
    if (this.use[i] === USE.PLOT) this.use[i] = USE.FREE;
    const v = this.villages[vid];
    if (!v) return;
    for (const p of v.plots) {
      const k = p.tiles.indexOf(i);
      if (k >= 0) {
        p.tiles.splice(k, 1);
        v.fieldCount--;
        break;
      }
    }
    v.plots = v.plots.filter((p) => p.tiles.length > 0);
    this.fieldVersion++;
  },

  _releasePlots(v) {
    const w = this.world;
    for (const p of v.plots)
      for (const i of p.tiles) {
        this.plotOf[i] = -1;
        if (this.use[i] === USE.PLOT) this.use[i] = USE.FREE;
        if (w.flora[i] === FLORA.WHEAT) w.setFlora(i % w.w, (i / w.w) | 0, FLORA.NONE);
      }
    v.plots = [];
    v.fieldCount = 0;
    this.fieldVersion++;
  },

  // ---------------------------------------------------------------- walls
  _planWalls(v, maxLen = Math.round(72 * F)) {
    for (const s of [1, 0.9]) {
      const plan = this._wallRing(v, s);
      if (plan.length <= maxLen) {
        v.wallPlan = plan;
        v.wallsPlanned = true;
        return plan.length;
      }
    }
    v.wallPlan = [];
    v.wallsPlanned = true;
    return 0;
  },

  _wallRing(v, scale = 1) {
    const w = this.world;
    const W = w.w;
    const cx = v.cx,
      cz = v.cz;
    const K = 18;
    const rMin = Math.max(3.5, 6 * F),
      rMax = 24 * F;
    const rad = new Float32Array(K).fill(rMin);
    const clear = 1.4 + 0.8 * F; // a lane between the last houses and the wall
    const consider = (x, z) => {
      const a = Math.atan2(z - cz, x - cx);
      const k = ((Math.round((a / (Math.PI * 2)) * K) % K) + K) % K;
      const d = Math.hypot(x - cx, z - cz) + clear;
      if (d > rad[k]) rad[k] = d;
    };
    for (const b of v.buildings) {
      if (!b.alive || BUILDING_TYPES[b.type].wall || b.type === 'docks') continue;
      consider(b.tx - 0.5, b.ty - 0.5);
      consider(b.tx + b.w + 0.5, b.ty - 0.5);
      consider(b.tx - 0.5, b.ty + b.h + 0.5);
      consider(b.tx + b.w + 0.5, b.ty + b.h + 0.5);
    }
    // smooth & cap
    const r2 = new Float32Array(K);
    for (let k = 0; k < K; k++) r2[k] = Math.max(rMin, Math.min(rMax, Math.max(rad[k], (rad[(k + K - 1) % K] + rad[k] * 2 + rad[(k + 1) % K]) / 4)) * scale);
    const pts = [];
    for (let k = 0; k < K; k++) {
      const a = (k / K) * Math.PI * 2;
      pts.push([Math.floor(cx + Math.cos(a) * r2[k]), Math.floor(cz + Math.sin(a) * r2[k])]);
    }
    const ring = [];
    const seen = new Set();
    const towersAt = new Set();
    for (let k = 0; k < K; k++) {
      const [x0, y0] = pts[k];
      const [x1, y1] = pts[(k + 1) % K];
      if (k % 2 === 0) towersAt.add(y0 * W + x0);
      // Bresenham
      let x = x0,
        y = y0;
      const dx = Math.abs(x1 - x0),
        dy = -Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1,
        sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      for (let guard = 0; guard < 200; guard++) {
        const i = y * W + x;
        if (w.inBounds(x, y) && !seen.has(i)) {
          seen.add(i);
          ring.push(i);
        }
        if (x === x1 && y === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) {
          err += dy;
          x += sx;
        }
        if (e2 <= dx) {
          err += dx;
          y += sy;
        }
      }
    }
    // orthogonalise diagonal steps so the wall is watertight
    const out = [];
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k],
        b = ring[(k + 1) % ring.length];
      out.push(a);
      const ax = a % W,
        ay = (a / W) | 0,
        bx = b % W,
        by = (b / W) | 0;
      if (Math.abs(ax - bx) === 1 && Math.abs(ay - by) === 1) {
        const m = ay * W + bx;
        if (!seen.has(m)) {
          seen.add(m);
          out.push(m);
        }
      }
    }
    const plan = [];
    let n = 0;
    for (const i of out) {
      const x = i % W,
        y = (i / W) | 0;
      if (w.height[i] < SEA_LEVEL + 0.05) continue;
      const u = this.use[i];
      if (u === USE.BUILDING || u === USE.RUIN) continue;
      const t = w.type[i];
      if (!TILE_INFO[t].walkable) continue;
      let type = 'wall';
      if (u === USE.ROAD) {
        // one gatehouse per street: the rest of a wide paved crossing stays open
        const last = plan[plan.length - 1];
        if (last && last.type === 'gate' && Math.abs(last.x - x) + Math.abs(last.y - y) <= 2) continue;
        type = 'gate';
      }
      else if (towersAt.has(i) || n % 7 === 3) type = 'tower';
      n++;
      plan.push({ i, x, y, type });
    }
    return plan;
  },

  // Build the next few wall sections of a planned ring.
  _advanceWalls(v, maxNew = 4) {
    if (!v.wallPlan || !v.wallPlan.length) return 0;
    let made = 0;
    while (v.wallPlan.length && made < maxNew) {
      const p = v.wallPlan[0];
      const cost = costOf(p.type);
      if (!canAfford(v, cost)) break;
      v.wallPlan.shift();
      const i = p.i;
      const u = this.use[i];
      if (u === USE.BUILDING || u === USE.RUIN) continue;
      if (p.type !== 'gate' && u === USE.ROAD) continue;
      if (u === USE.PLOT) this._removePlotTile(i);
      if (p.type === 'gate') {
        // gate keeps the road underneath; orient along the road
        const w = this.world;
        const ew = this._roadNeighbourAt(p.x - 1, p.y) || this._roadNeighbourAt(p.x + 1, p.y);
        this.use[i] = USE.FREE;
        const b = this.addBuilding(v, 'gate', p.x, p.y, ew ? 1 : 0, { noFlatten: true });
        if (w.building[i] === b.id) w.building[i] = -1; // an open gate: the road runs through
        b.y = w.height[i];
        b.groundMin = this._groundMin(b);
      } else {
        if (this.world.flora[i] === FLORA.BOULDER) continue;
        this.use[i] = USE.FREE;
        const b = this.addBuilding(v, p.type, p.x, p.y, 0, { noFlatten: true });
        b.y = this.world.heightAt(p.x + 0.5, p.y + 0.5);
        b.groundMin = this._groundMin(b);
      }
      pay(v, cost);
      made++;
    }
    return made;
  },

  _roadNeighbourAt(x, y) {
    const w = this.world;
    return w.inBounds(x, y) && this.use[y * w.w + x] === USE.ROAD;
  },

  // ---------------------------------------------------------------- special sites
  _placeDocks(v, type = 'docks') {
    const w = this.world;
    const W = w.w;
    const n = spiralCount(Math.min(SPIRAL[SPIRAL.length - 1][2], v.buildRadius + cells(6, 3)));
    let best = null,
      bs = Infinity;
    const cx = Math.floor(v.cx),
      cy = Math.floor(v.cz);
    // the pier reaches this many tiles out (the model's 3.3 at BUILDING scale)
    const reach = Math.max(2, Math.ceil(3 * F + 0.5));
    for (let k = 0; k < n; k += 1) {
      const [dx, dy, d] = SPIRAL[k];
      if (d < 3) continue;
      const x = cx + dx,
        y = cy + dy;
      for (let rot = 0; rot < 4; rot++) {
        const [fx, fz] = ROT_DIR[rot];
        const fw = rot & 1 ? BUILDING_TYPES[type].h : BUILDING_TYPES[type].w,
          fh = rot & 1 ? BUILDING_TYPES[type].w : BUILDING_TYPES[type].h;
        if (!this._footprintOK(x, y, fw, fh, 1.2)) continue;
        // the tiles in front of the door edge, out past the pier, must be water
        const across = fz ? fw : fh;
        let water = 0,
          deep = 0;
        for (let s = 1; s <= reach; s++) {
          for (let o = 0; o < across; o++) {
            let tx, ty;
            if (fz === 1) [tx, ty] = [x + o, y + fh - 1 + s];
            else if (fz === -1) [tx, ty] = [x + o, y - s];
            else if (fx === 1) [tx, ty] = [x + fw - 1 + s, y + o];
            else [tx, ty] = [x - s, y + o];
            if (!w.inBounds(tx, ty)) continue;
            const h = w.height[ty * W + tx];
            if (h < SEA_LEVEL) water++;
            if (h < SEA_LEVEL - 0.5) deep++;
          }
        }
        if (water < reach * across || deep < Math.max(1, across)) continue;
        const sc = d + this.rng.next();
        if (sc < bs) {
          bs = sc;
          best = { x, y, rot };
        }
      }
      if (best && k > 200) break;
    }
    if (!best) return null;
    const b = this.addBuilding(v, type, best.x, best.y, best.rot);
    // walk-able link from the docks to the street network
    const back = (best.rot + 2) & 3;
    const [bx, bz] = ROT_DIR[back];
    const sx = Math.floor(b.x + bx * 1.5),
      sy = Math.floor(b.z + bz * 1.5);
    if (w.inBounds(sx, sy) && this.use[sy * W + sx] === USE.FREE) this._connectToRoads(v, sx, sy);
    return b;
  },

  // Free-standing placement (not on a street): watchtowers on the outskirts.
  _placeOutskirts(v, type, minR, maxR, towardX = null, towardZ = null) {
    const def = BUILDING_TYPES[type];
    const rng = this.rng;
    // a city (tier 2+) keeps its pens and herds beyond its core, out with the fields
    if (type === 'pasture' && v.tier >= 2) {
      minR = Math.max(minR, v.radius * 0.95);
      maxR = Math.max(maxR, minR + 4);
    }
    if (FARM_OUT.has(type) && (this.kingdoms[v.kingdom]?.era || 0) >= 5) {
      minR = Math.max(minR, this._pavedRadius(v) + 0.5);
      maxR = Math.max(maxR, minR + 5);
    }
    let best = null,
      bs = Infinity;
    for (let k = 0; k < 60; k++) {
      let a = rng.float(0, Math.PI * 2);
      if (towardX != null) a = Math.atan2(towardZ - v.cz, towardX - v.cx) + rng.float(-0.7, 0.7);
      const r = rng.float(minR, maxR);
      const x = Math.floor(v.cx + Math.cos(a) * r),
        y = Math.floor(v.cz + Math.sin(a) * r);
      const rot = rng.int(0, 3);
      const fw = rot & 1 ? def.h : def.w,
        fh = rot & 1 ? def.w : def.h;
      if (!this._footprintOK(x, y, fw, fh, 1.0)) continue;
      const st = this._footprintStats(x, y, fw, fh);
      const s = st.slope * 2 + st.trees + rng.next() * 3 - this.world.height[y * this.world.w + x] * 0.3;
      if (s < bs) {
        bs = s;
        best = { x, y, rot };
      }
    }
    if (!best) return null;
    const b = this.addBuilding(v, type, best.x, best.y, best.rot);
    const [ddx, ddz] = ROT_DIR[best.rot];
    const dx = Math.floor(b.doorX),
      dz = Math.floor(b.doorZ);
    if (this.world.inBounds(dx, dz)) this._connectToRoads(v, dx, dz);
    return b;
  },
};
