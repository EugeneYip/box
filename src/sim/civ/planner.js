import { TILE, TILE_INFO, FLORA, FLORA_INFO, SEA_LEVEL } from '../../world/constants.js';
import { BUILDING_TYPES, costOf, canAfford, pay } from './catalog.js';
import { CULTURES, baseCulture } from './cultures.js';
import { USE, ROT, ROT_DIR, SPIRAL, spiralCount, clamp, lerp } from './util.js';
import { civPath } from './pathing.js';

// Village planning: site scoring, building placement along streets, road
// growth, field plots, city walls and terrain levelling. Mixed into
// Civilization.prototype (so `this` is the Civilization).

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
    const n = spiralCount(11);
    for (let k = 0; k < n; k++) {
      const [dx, dy, d] = SPIRAL[k];
      const x = tx + dx,
        y = ty + dy;
      if (!w.inBounds(x, y)) continue;
      const i = y * w.w + x;
      if (w.height[i] < SEA_LEVEL) {
        if (d <= 9) water++;
        continue;
      }
      const t = w.type[i];
      const f = w.flora[i];
      if (TILE_INFO[t].buildable && TILE_INFO[t].walkable && this.use[i] === USE.FREE && w.slopeAt(x, y) < 1.0 && f !== FLORA.BOULDER) {
        space++;
        fert += TILE_INFO[t].fertile;
      }
      if (FLORA_INFO[f]?.isTree) trees++;
      if (f === FLORA.BOULDER || f === FLORA.ROCK_SMALL || t === TILE.ROCK) rocks++;
      if (opts.kingdom != null && w.owner[i] >= 0 && w.owner[i] !== opts.kingdom) foreign++;
      else if (opts.kingdom == null && w.owner[i] >= 0) foreign++;
    }
    if (space < (opts.minSpace ?? 120)) return -1;
    if (foreign > 30) return -1;
    let s = space * 1.0 + fert * 0.7 + Math.min(trees, 50) * 0.6 + Math.min(rocks, 16) * 1.6;
    if (water > 2) s += 24;
    if (water > 120) s -= (water - 120) * 0.6;
    s -= foreign * 3;
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
    const roads = v.roadTiles;
    if (!roads.length) return null;
    const rng = this.rng;
    const limit = 220;
    let best = null,
      bestS = Infinity;
    const hx = v.cx,
      hz = v.cz;
    const maxR = v.buildRadius + 2;
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
        if (!this._footprintOK(tx0, ty0, fw, fh)) continue;
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
        const o = (nb[0] + 2) & 3;
        cands.push({ x, y, d: o, tip: true });
        cands.push({ x, y, d: (o + 1) & 3, tip: true, turn: true });
        cands.push({ x, y, d: (o + 3) & 3, tip: true, turn: true });
      } else if (nb.length === 2 && ((nb[0] + 2) & 3) === nb[1]) {
        cands.push({ x, y, d: (nb[0] + 1) & 3, tip: false });
        cands.push({ x, y, d: (nb[0] + 3) & 3, tip: false });
      }
    }
    let best = null,
      bs = -Infinity;
    for (const c of cands) {
      const [dx, dy] = ROT_DIR[c.d];
      const len = 6 + ((rng.next() * 3) | 0);
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
      if (s > bs) {
        bs = s;
        best = { ...c, len: ok };
      }
    }
    if (!best) return false;
    const [dx, dy] = ROT_DIR[best.d];
    this._street(v, best.x + dx, best.y + dy, dx, dy, best.len);
    this.fieldVersion++;
    return true;
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
    if (this.use[start] === USE.FREE || this.use[start] === USE.PLOT) this.layRoad(v, start);
    for (const i of p) {
      if (this.use[i] === USE.ROAD) break;
      if (this.use[i] === USE.BUILDING) continue;
      this.layRoad(v, i);
    }
    return true;
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
    const mid = (p.length / 2) | 0;
    for (let k = 0; k < p.length; k++) {
      const i = p[k];
      if (this.use[i] === USE.BUILDING) continue;
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
    if (v.culture === 'dune' && (t === TILE.SAND || t === TILE.DESERT)) return true;
    if (v.culture === 'frost' && t === TILE.SNOW) return true;
    return false;
  },

  _planPlot(v) {
    const w = this.world;
    const W = w.w;
    const rng = this.rng;
    const sizes = [
      [4, 3],
      [3, 4],
      [4, 4],
      [5, 3],
      [3, 5],
      [5, 4],
      [4, 5],
    ];
    const minD = 4 + v.tier;
    const maxD = v.buildRadius + 11;
    let best = null,
      bs = Infinity;
    for (let k = 0; k < 90; k++) {
      let ax, ay;
      if (v.plots.length && rng.chance(0.6)) {
        const p = v.plots[(rng.next() * v.plots.length) | 0];
        const side = rng.int(0, 3);
        const [pw, ph] = [p.x1 - p.x0 + 1, p.y1 - p.y0 + 1];
        if (side === 0) {
          ax = p.x1 + 2;
          ay = p.y0 + rng.int(-1, ph - 1);
        } else if (side === 1) {
          ax = p.x0 - 2 - 4;
          ay = p.y0 + rng.int(-1, ph - 1);
        } else if (side === 2) {
          ax = p.x0 + rng.int(-1, pw - 1);
          ay = p.y1 + 2;
        } else {
          ax = p.x0 + rng.int(-1, pw - 1);
          ay = p.y0 - 2 - 4;
        }
      } else {
        const a = rng.float(0, Math.PI * 2),
          r = rng.float(minD, maxD);
        ax = Math.floor(v.cx + Math.cos(a) * r);
        ay = Math.floor(v.cz + Math.sin(a) * r);
      }
      const [sw, sh] = sizes[(rng.next() * sizes.length) | 0];
      const x0 = ax,
        y0 = ay;
      if (x0 < 3 || y0 < 3 || x0 + sw > w.w - 3 || y0 + sh > w.h - 3) continue;
      const cx = x0 + sw / 2,
        cy = y0 + sh / 2;
      const d = Math.hypot(cx - v.cx, cy - v.cz);
      if (d < minD || d > maxD + 3) continue;
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
      if (!ok || hmax - hmin > 1.0) continue;
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
        best = { x0, y0, x1: x0 + sw - 1, y1: y0 + sh - 1 };
      }
    }
    if (!best) return null;
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
  _planWalls(v, maxLen = 72) {
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
    const rad = new Float32Array(K).fill(6);
    const consider = (x, z) => {
      const a = Math.atan2(z - cz, x - cx);
      const k = ((Math.round((a / (Math.PI * 2)) * K) % K) + K) % K;
      const d = Math.hypot(x - cx, z - cz) + 2.2;
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
    for (let k = 0; k < K; k++) r2[k] = Math.max(6, Math.min(24, Math.max(rad[k], (rad[(k + K - 1) % K] + rad[k] * 2 + rad[(k + 1) % K]) / 4)) * scale);
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
    const n = spiralCount(Math.min(SPIRAL[SPIRAL.length - 1][2], v.buildRadius + 6));
    let best = null,
      bs = Infinity;
    const cx = Math.floor(v.cx),
      cy = Math.floor(v.cz);
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
        // the two tiles in front of the door edge and 3 beyond must be water
        let water = 0,
          deep = 0;
        for (let s = 1; s <= 3; s++) {
          for (let o = 0; o < 2; o++) {
            let tx, ty;
            if (fz === 1) [tx, ty] = [x + o, y + 1 + s];
            else if (fz === -1) [tx, ty] = [x + o, y - s];
            else if (fx === 1) [tx, ty] = [x + 1 + s, y + o];
            else [tx, ty] = [x - s, y + o];
            if (!w.inBounds(tx, ty)) continue;
            const h = w.height[ty * W + tx];
            if (h < SEA_LEVEL) water++;
            if (h < SEA_LEVEL - 0.5) deep++;
          }
        }
        if (water < 6 || deep < 2) continue;
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
