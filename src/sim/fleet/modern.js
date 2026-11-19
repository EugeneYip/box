import { SEA_LEVEL, TILE } from '../../world/constants.js';
import { KINDS, AIR_KINDS } from './kinds.js';
import { civPath } from '../civ/pathing.js';
import { USE } from '../civ/util.js';

// The advanced boats and the civic vehicles (docs/TECH-BREADTH.md sections
// 3 and 4), mixed into Fleet, and the god powers' way in (spawnVehicle).
//
//   icebreakers   sail to the ice off their realm's harbours and cut a
//                 channel of open water through it
//   hovercraft    run from a harbour across shallows and onto the beach of a
//                 nearby town, and back
//   destroyers    patrol their realm's waters in peace (and fight in war)
//   research      vessels survey far waters; each survey speeds research
//   fire engines  race to fires in and around the towns of a realm with
//                 Fire Engines and put them out
//   ambulances    drive to the wounded and the sick (Antibiotics) and heal them
//   tractors      work the fields (Mechanized Farming)
//   trams, buses  run through the towns (Public Transit)
//   helicopters   fly to disasters from the Modern era and lift out the hurt
//
// PUBLIC CONTRACT (additions to game.fleet)
//   spawnVehicle(kind, x, z, kingdom) -> vehicle | flight | null (lastRefusal says why)
//   solarStormStart(seconds)            satellites tumble, aircraft grounded, auroras
//   events 'fleet:rescue' {flight, kingdom, x, z, saved}
//          'fleet:fire'   {vehicle, kingdom, village, x, z}   a fire engine at work
//          'fleet:healed' {vehicle, kingdom, unit}
export const modern = {
  // ------------------------------------------------------------------ scheduler
  _scheduleModern(k) {
    const kid = k.id;
    const t = this._kt(kid);
    const now = this.game.time.total;
    const civ = this.game.civ;
    if (this.law('fleetSailing')) {
      if (now - (t.ice ?? -999) > 40 && this.canUse(kid, 'icebreaker')) {
        t.ice = now;
        if (this.count(kid, 'icebreaker') < 1 && this.seaCount() < this.budget.sea) this._sendIcebreaker(k);
      }
      if (now - (t.hover ?? -999) > 24 && this.canUse(kid, 'hovercraft')) {
        t.hover = now;
        if (this.count(kid, 'hovercraft') < 2 && this.seaCount() < this.budget.sea) this._sendHover(k);
      }
      if (now - (t.patrolT ?? -999) > 50 && this.canUse(kid, 'patrol') && this.law('fleetNaval')) {
        t.patrolT = now;
        if (!(civ.enemiesOf?.(kid) || []).length && this.count(kid, 'patrol') < 1 && this.seaCount() < this.budget.sea * 0.9) this._sendPatrol(k);
      }
    }
    if (now - (t.civic ?? -999) > 3) {
      t.civic = now;
      this._scheduleCivic(k);
    }
  },

  // ------------------------------------------------------------------ icebreakers
  _sendIcebreaker(k) {
    const w = this.world;
    const nav = this.nav;
    let best = null,
      bd = Infinity;
    for (const h of this.harbours(k.id)) {
      if (this.blockaded(h)) continue;
      const bx = Math.floor(h.berth.x),
        bz = Math.floor(h.berth.z);
      for (let dz = -40; dz <= 40; dz += 2)
        for (let dx = -40; dx <= 40; dx += 2) {
          const x = bx + dx,
            z = bz + dz;
          if (!w.inBounds(x, z)) continue;
          const i = z * w.w + x;
          if (w.type[i] !== TILE.ICE || w.height[i] >= SEA_LEVEL) continue;
          // the edge of the ice: open water of this harbour's sea beside it
          for (const [ox, oz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
            const wx = x + ox + 0.5,
              wz = z + oz + 0.5;
            if (!nav.isWater(wx, wz) || nav.comp(wx, wz) !== h.water) continue;
            const d = Math.hypot(dx, dz);
            if (d < bd) (bd = d), (best = { h, x: wx, z: wz, ix: x + 0.5, iz: z + 0.5 });
            break;
          }
        }
    }
    if (!best) return;
    const at = this._launchAt(best.h, 'icebreaker');
    const v = this.spawn('icebreaker', k.id, at.x, at.z, { home: best.h.village, harbour: best.h.id, heading: Math.atan2(best.h.dirZ, best.h.dirX) });
    if (!v) return;
    v.mission = { type: 'ice', phase: 'out', ix: best.ix, iz: best.iz };
    v.voyage = { from: best.h.village, fromHarbour: best.h.id, fromName: best.h.name, toName: 'the ice', t0: this.game.time.total };
    if (!this._sail(v, best)) this.remove(v);
  },
  _iceArrive(v) {
    v.state = 'break';
    v.stateT = 0;
    v.heading = Math.atan2(v.mission.iz - v.z, v.mission.ix - v.x);
  },
  // Breaking ice: the bow rides up and crushes the sheet ahead, leaving a
  // channel of open water astern (the water graph is patched as it goes).
  _iceTick(v, step) {
    const w = this.world;
    const m = v.mission;
    v.speed = v.def.speed * 0.3;
    if ((m.cut = (m.cut || 0) - step) <= 0) {
      m.cut = 0.4;
      const ax = v.x + Math.cos(v.heading) * 1.0,
        az = v.z + Math.sin(v.heading) * 1.0;
      let n = 0;
      for (let dz = -2; dz <= 2; dz++)
        for (let dx = -2; dx <= 2; dx++) {
          const x = Math.floor(ax) + dx,
            z = Math.floor(az) + dz;
          if (!w.inBounds(x, z) || Math.hypot(x + 0.5 - ax, z + 0.5 - az) > 1.7) continue;
          const i = z * w.w + x;
          if (w.type[i] !== TILE.ICE || w.height[i] >= SEA_LEVEL) continue;
          w.setType(x, z, -w.height[i] < 2.8 ? TILE.SAND : TILE.ROCK);
          if (this._ice) this._ice[i] = 0;
          n++;
        }
      if (n) {
        this.nav.markDirty({ x0: Math.floor(ax) - 3, y0: Math.floor(az) - 3, x1: Math.floor(ax) + 3, y1: Math.floor(az) + 3 });
        this._fx('splash', ax, az, 0.6);
        if (!this.firsts.has(v.kingdom + '|icecut')) {
          this.firsts.add(v.kingdom + '|icecut');
          this.note(`🧊 An icebreaker of ${this.kname(v.kingdom)} cuts a channel through the frozen sea`, 'good', { x: ax, z: az }, 'icecut' + v.kingdom, 1);
        }
      }
      m.left = n ? 0 : (m.left || 0) + 1;
    }
    // on into the channel just cut (never onto land)
    const nx = v.x + Math.cos(v.heading) * v.speed * step,
      nz = v.z + Math.sin(v.heading) * v.speed * step;
    const tx = Math.floor(nx),
      tz = Math.floor(nz);
    const ok = w.inBounds(tx, tz) && w.height[tz * w.w + tx] < SEA_LEVEL - 0.1 && w.type[tz * w.w + tx] !== TILE.ICE;
    if (ok) {
      v.x = nx;
      v.z = nz;
    }
    // enough: after a long cut, when the ice runs out, or the way is barred
    if (v.stateT > 28 || m.left > 6 || (!ok && v.stateT > 3)) {
      m.phase = 'home';
      v.state = 'sail';
      this._goHome(v);
    }
  },

  // ------------------------------------------------------------------ hovercraft
  _sendHover(k) {
    const civ = this.game.civ;
    const w = this.world;
    const H = this.harbours(k.id).filter((h) => !this.blockaded(h));
    if (!H.length) return;
    const h = H[Math.floor(this.rng() * H.length)];
    // a beach of another town nearby, at peace
    let best = null,
      bd = Infinity;
    for (const v of civ.villages) {
      if (!v.alive || v.id === h.village || this.atWar(v.kingdom, k.id)) continue;
      const d = this.dist(v.cx, v.cz, h.berth.x, h.berth.z);
      if (d < 12 || d > 48 || d >= bd) continue;
      const b = this._beach(v.cx, v.cz, (v.radius || 6) + 6);
      if (b) (bd = d), (best = { v, b });
    }
    if (!best) return;
    const path = this._hoverPath(h.berth.x, h.berth.z, best.b.x, best.b.z, h.water);
    if (!path) return;
    const at = this._launchAt(h, 'hovercraft');
    const v = this.spawn('hovercraft', k.id, at.x, at.z, { home: h.village, harbour: h.id, heading: Math.atan2(h.dirZ, h.dirX) });
    if (!v) return;
    v.mission = { type: 'ferry', phase: 'out', from: h.id, back: null };
    v.voyage = { from: h.village, to: best.v.id, fromHarbour: h.id, fromName: h.name, toName: best.v.name, t0: this.game.time.total };
    v.path = [at.x, at.z, ...path];
    v.pi = 2;
    v.state = 'sail';
    void w;
  },
  // A low beach: dry land just above the sea with water beside it.
  _beach(cx, cz, r) {
    const w = this.world;
    for (let k = 0; k < 40; k++) {
      const a = this.rng() * Math.PI * 2,
        d = r * (0.4 + this.rng() * 0.6);
      const x = Math.floor(cx + Math.cos(a) * d),
        z = Math.floor(cz + Math.sin(a) * d);
      if (!w.inBounds(x, z)) continue;
      const hh = w.height[z * w.w + x];
      if (hh < SEA_LEVEL + 0.02 || hh > SEA_LEVEL + 0.45) continue;
      if (this.game.civ?.use?.[z * w.w + x] === USE.BUILDING) continue;
      for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (w.inBounds(x + ox, z + oz) && w.height[(z + oz) * w.w + x + ox] < SEA_LEVEL - 0.05) return { x: x + 0.5, z: z + 0.5 };
    }
    return null;
  },
  // Straight across water and low land when it can, else round by the water.
  _hoverPath(x0, z0, x1, z1, comp) {
    const w = this.world;
    const d = Math.hypot(x1 - x0, z1 - z0);
    let ok = true;
    for (let s = 0; s <= d && ok; s += 0.5) {
      const x = x0 + ((x1 - x0) * s) / d,
        z = z0 + ((z1 - z0) * s) / d;
      if (w.heightAt(x, z) > SEA_LEVEL + 0.55) ok = false;
    }
    if (ok) return [x1, z1];
    const nav = this.nav;
    const L = nav.waterNear(x1, z1, 3, 0.3);
    if (!L || nav.comp(L.x, L.z) !== comp) return null;
    const p = nav.findPath(x0, z0, L.x, L.z, { big: false, minClear: 0 });
    return p ? [...p, x1, z1] : null;
  },
  // On its cushion of air: over the water, up the beach, and home again.
  _hoverTick(v, step) {
    const w = this.world;
    const m = v.mission;
    v.y = Math.max(0, w.heightAt(v.x, v.z));
    if (v.state === 'moored') {
      v.speed = 0;
      v.idleT += step;
      if (v.idleT > 90) this.remove(v);
      return;
    }
    if (v.state === 'beach') {
      v.speed = 0;
      if (v.stateT > 6) {
        v.state = 'sail';
        const back = [];
        for (let i = v.path0.length - 2; i >= 0; i -= 2) back.push(v.path0[i], v.path0[i + 1]);
        v.path = back;
        v.pi = 0;
        if (m) m.phase = 'home';
      }
      return;
    }
    if (!v.path) return;
    const P = v.path;
    let tx = P[v.pi],
      tz = P[v.pi + 1];
    while (Math.hypot(tx - v.x, tz - v.z) < 0.5 && v.pi < P.length - 2) {
      v.pi += 2;
      tx = P[v.pi];
      tz = P[v.pi + 1];
    }
    const dd = Math.hypot(tx - v.x, tz - v.z);
    if (v.pi >= P.length - 2 && dd < 0.4) {
      if (m?.phase === 'out') {
        v.path0 = P;
        v.path = null;
        v.state = 'beach';
        v.stateT = 0;
        this._fx('splash', v.x, v.z, 0.5);
      } else {
        v.state = 'moored';
        v.mission = null;
        v.idleT = 0;
        v.path = null;
      }
      return;
    }
    let diff = Math.atan2(tz - v.z, tx - v.x) - v.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    v.heading += Math.max(-v.def.turn * step, Math.min(v.def.turn * step, diff));
    const target = v.def.speed * (Math.abs(diff) > 1 ? 0.3 : 1) * (dd < 2 ? 0.4 + dd * 0.3 : 1);
    v.speed += (target - v.speed) * Math.min(1, step * 1.5);
    const nx = v.x + Math.cos(v.heading) * v.speed * step,
      nz = v.z + Math.sin(v.heading) * v.speed * step;
    if (w.heightAt(nx, nz) < SEA_LEVEL + 0.6) {
      v.x = nx;
      v.z = nz;
      this._wrapVessel(v);
    } else v.speed *= 0.3;
    // spray off the skirt over the water
    if (v.speed > 1 && w.heightAt(v.x, v.z) < SEA_LEVEL && this.rng() < step * 2) this._fx('splash', v.x - Math.cos(v.heading) * 0.4, v.z - Math.sin(v.heading) * 0.4, 0.3);
  },

  // ------------------------------------------------------------------ destroyers in peace
  _sendPatrol(k) {
    const nav = this.nav;
    const H = this.harbours(k.id).filter((h) => !this.blockaded(h));
    if (!H.length) return;
    const h = H[Math.floor(this.rng() * H.length)];
    let pt = null;
    for (let i = 0; i < 20 && !pt; i++) {
      const a = Math.atan2(h.dirZ, h.dirX) + (this.rng() - 0.5) * 2.4,
        r = 12 + this.rng() * 16;
      const x = h.berth.x + Math.cos(a) * r,
        z = h.berth.z + Math.sin(a) * r;
      if (nav.isWater(x, z) && nav.comp(x, z) === h.water && nav.clearAt(x, z) >= 2) pt = { x, z };
    }
    if (!pt) return;
    const at = this._launchAt(h, 'patrol');
    const v = this.spawn('patrol', k.id, at.x, at.z, { home: h.village, harbour: h.id, heading: Math.atan2(h.dirZ, h.dirX) });
    if (!v) return;
    v.mission = { type: 'cruise', phase: 'out' };
    v.voyage = { from: h.village, fromHarbour: h.id, fromName: h.name, toName: 'its home waters', t0: this.game.time.total };
    if (!this._sail(v, pt)) this.remove(v);
  },

  // ------------------------------------------------------------------ research
  _surveyed(v) {
    const K = this.kingdom(v.kingdom);
    if (!K) return;
    K.knowledge = (K.knowledge || 0) + (K.knowRate || 1) * 30; // a year's research
    if (!this.firsts.has(v.kingdom + '|survey')) {
      this.firsts.add(v.kingdom + '|survey');
      this.note(`🔬 A research vessel of ${this.kname(v.kingdom)} brings home its first survey of the deep`, 'good', { x: v.x, z: v.z }, 'survey' + v.kingdom, 1);
    }
  },

  // ------------------------------------------------------------------ civic vehicles
  _scheduleCivic(k) {
    const kid = k.id;
    const civ = this.game.civ;
    const fire = this.canUse(kid, 'fireengine'),
      medic = this.canUse(kid, 'ambulance'),
      farm = this.canUse(kid, 'tractor'),
      transit = this.canUse(kid, 'tram'),
      heli = this.canUse(kid, 'helicopter');
    if (!fire && !medic && !farm && !transit && !heli) return;
    const now = this.game.time.total;
    const T = this._civT || (this._civT = new Map());
    const roomy = this.landCount() < this.budget.land;
    if (fire) this._fireScan();
    for (const vid of k.villages) {
      const v = civ.villages[vid];
      if (!v?.alive) continue;
      let t = T.get(vid);
      if (!t) T.set(vid, (t = { fire: 0, medic: 0, farm: now + this.rng() * 20, transit: now + this.rng() * 10 }));
      if (fire && now >= t.fire && this._fireCall(k, v)) t.fire = now + 6;
      if (!roomy) continue;
      if (medic && now >= t.medic) {
        t.medic = now + 8;
        this._medicCall(k, v);
      }
      if (farm && now >= t.farm) {
        t.farm = now + 25 + this.rng() * 20;
        this._sendTractor(k, v);
      }
      if (transit && now >= t.transit && (v.tier || 0) >= 1) {
        t.transit = now + 14 + this.rng() * 10;
        this._sendTransit(k, v);
      }
    }
    if (heli && now - (this._kt(kid).heli ?? -999) > 20) {
      this._kt(kid).heli = now;
      this._rescueCall(k);
    }
  },
  // A building of the town a service runs from: the first of these types
  // there (Civ may add fire stations and hospitals), else the town hall.
  _base(v, types) {
    for (const b of v.buildings || []) if (b.alive && !b.constructing && types.includes(b.type)) return b;
    return v.hall?.alive ? v.hall : null;
  },
  _doorOf(b) {
    return { x: b.doorX ?? b.x, z: b.doorZ ?? b.z };
  },
  // Streets first, the open ground for the last stretch; null when it is out of reach.
  _streetPath(x0, z0, x1, z1, maxNodes = 2500) {
    const w = this.world;
    const use = this.game.civ?.use;
    const sx = Math.floor(x0),
      sz = Math.floor(z0),
      gx = Math.floor(x1),
      gz = Math.floor(z1);
    if (!w.inBounds(sx, sz) || !w.inBounds(gx, gz)) return null;
    const cost = (i) => {
      if (use && use[i] === USE.ROAD) return 1;
      if (use && use[i] === USE.BUILDING) return Infinity;
      const x = i % w.w,
        y = (i / w.w) | 0;
      return w.isWalkable(x, y) ? 3 : Infinity;
    };
    const p = civPath(w, sx, sz, gx, gz, cost, maxNodes, 1);
    if (!p || !p.length) return null;
    const last = p[p.length - 1];
    if (Math.hypot((last % w.w) - gx, ((last / w.w) | 0) - gz) > 2.5) return null;
    const path = [x0, z0];
    for (const i of p) path.push((i % w.w) + 0.5, ((i / w.w) | 0) + 0.5);
    if (path.length < 4) path.push(x1, z1);
    return path;
  },
  _service(kind, k, v, from, path, mission) {
    const veh = this.spawn(kind, k.id, path[0], path[1], { home: v.id, state: 'move', heading: Math.atan2(path[3] - path[1], path[2] - path[0]) });
    if (!veh) return null;
    veh.mission = { from: v.id, to: v.id, ...mission };
    veh.voyage = { from: v.id, to: v.id, fromName: v.name, toName: v.name };
    veh.base = { x: path[0], z: path[1] };
    this.setPath(veh, path);
    return veh;
  },
  // Fires burning now: a sample of the burning tiles, refreshed each beat.
  _fireScan() {
    const now = this.game.time.total;
    if (this._fires && this._fires.t === now) return this._fires;
    const fs = this.game.disasters?.fire;
    const w = this.world;
    const L = [];
    if (fs && fs.count) {
      const stride = Math.max(1, Math.ceil(fs.count / 600));
      for (let j = 0; j < fs.count; j += stride) {
        const i = fs.list[j];
        if (w.fire[i] > 0.05) L.push((i % w.w) + 0.5, ((i / w.w) | 0) + 0.5);
      }
    }
    return (this._fires = { t: now, L });
  },
  _fireCall(k, v) {
    // already an engine on its way here?
    for (const o of this.list) if (o.alive && o.kind === 'fireengine' && o.mission?.type === 'fire' && o.mission.vid === v.id && o.mission.phase === 'out') return false;
    let tgt = null;
    for (const b of v.buildings || []) if (b.alive && b.burning > 0.12) {
      tgt = { x: b.x, z: b.z };
      break;
    }
    if (!tgt) {
      const R = (v.radius || 6) + 4;
      const L = this._fireScan().L;
      let bd = R;
      for (let i = 0; i < L.length; i += 2) {
        const d = this.dist(L[i], L[i + 1], v.cx, v.cz);
        if (d < bd) (bd = d), (tgt = { x: L[i], z: L[i + 1] });
      }
    }
    if (!tgt || this.count(k.id, 'fireengine') >= 2 + (k.villages.length >> 2) || this.landCount() >= this.budget.land * 1.05) return false;
    const base = this._base(v, ['firestation', 'firehouse', 'fire']);
    if (!base) return false;
    const d = this._doorOf(base);
    // to the nearest open ground beside the blaze (a few tiles short)
    const stop = this._openNear(tgt.x, tgt.z, d.x, d.z);
    const path = stop && this._streetPath(d.x, d.z, stop.x, stop.z);
    if (!path) return false;
    const e = this._service('fireengine', k, v, base, path, { type: 'fire', phase: 'out', vid: v.id, tx: tgt.x, tz: tgt.z, siren: true });
    if (e) this.note(`🚒 Fire engines of ${this.kname(k.id)} race to a fire in ${v.name}`, 'info', tgt, 'fireengine' + v.id, 120);
    return !!e;
  },
  // A walkable tile near (x, z), on the side toward (fx, fz), out of the flames.
  _openNear(x, z, fx, fz) {
    const w = this.world;
    const use = this.game.civ?.use;
    let best = null,
      bs = Infinity;
    for (let dz = -3; dz <= 3; dz++)
      for (let dx = -3; dx <= 3; dx++) {
        const tx = Math.floor(x) + dx,
          tz = Math.floor(z) + dz;
        if (!w.inBounds(tx, tz) || !w.isWalkable(tx, tz)) continue;
        const i = tz * w.w + tx;
        if (use && use[i] === USE.BUILDING) continue;
        if (w.fire[i] > 0.05) continue;
        const d = Math.hypot(dx, dz);
        if (d < 1.2) continue;
        const s = Math.abs(d - 2) * 2 + (use && use[i] === USE.ROAD ? -1.5 : 0) + Math.hypot(tx - fx, tz - fz) * 0.05;
        if (s < bs) (bs = s), (best = { x: tx + 0.5, z: tz + 0.5 });
      }
    return best;
  },
  _medicCall(k, v) {
    const U = this.game.units;
    if (!U?.query) return;
    if (this.list.some((o) => o.alive && o.kind === 'ambulance' && o.mission?.vid === v.id && o.mission.phase === 'out')) return;
    if (this.count(k.id, 'ambulance') >= 1 + (k.villages.length >> 2)) return;
    const pts = U.query(v.cx, v.cz, (v.radius || 6) + 3, (u) => u.alive && u.species === 'human' && u.kingdom === k.id && !u._away && (u.statuses?.has('wounded') || u.statuses?.has('sick')));
    if (!pts?.length) return;
    const u = pts[Math.floor(this.rng() * pts.length)];
    const base = this._base(v, ['hospital', 'clinic', 'healer']);
    if (!base) return;
    const d = this._doorOf(base);
    const stop = this._openNear(u.x, u.z, d.x, d.z) || { x: u.x, z: u.z };
    const path = this._streetPath(d.x, d.z, stop.x, stop.z);
    if (!path) return;
    const a = this._service('ambulance', k, v, base, path, { type: 'medic', phase: 'out', vid: v.id, patient: u.id, siren: true });
    if (a) this.first(k.id, 'ambulance', { x: u.x, z: u.z });
  },
  _sendTractor(k, v) {
    if (!v.plots?.length) return;
    if (this.list.some((o) => o.alive && o.kind === 'tractor' && o.mission?.vid === v.id)) return;
    const w = this.world;
    const P = v.plots.filter((p) => p.tiles?.length && p.tiles.some((i) => w.type[i] === TILE.FARMLAND));
    if (!P.length) return;
    const p = P[Math.floor(this.rng() * P.length)];
    // up and down the rows of the plot, a furrow at a time
    const x0 = p.x0 + 0.5,
      x1 = p.x1 + 0.5,
      z0 = p.y0 + 0.5,
      z1 = p.y1 + 0.5;
    const path = [];
    const alongX = x1 - x0 >= z1 - z0;
    let flip = false;
    if (alongX)
      for (let z = z0; z <= z1 + 1e-3; z += 1, flip = !flip) path.push(flip ? x1 : x0, z, flip ? x0 : x1, z);
    else for (let x = x0; x <= x1 + 1e-3; x += 1, flip = !flip) path.push(x, flip ? z1 : z0, x, flip ? z0 : z1);
    if (path.length < 4) return;
    const t = this._service('tractor', k, v, null, path, { type: 'farm', phase: 'out', vid: v.id });
    if (t) this.first(k.id, 'tractor', { x: path[0], z: path[1] });
  },
  _sendTransit(k, v) {
    const n = this.list.filter((o) => o.alive && (o.kind === 'bus' || o.kind === 'tram') && o.mission?.vid === v.id).length;
    if (n >= ((v.tier || 0) >= 2 ? 2 : 1)) return;
    const leg = this._transitLeg(v, null);
    if (!leg) return;
    const kind = (v.tier || 0) >= 2 && this.rng() < 0.5 ? 'tram' : 'bus';
    const t = this._service(kind, k, v, null, leg, { type: 'transit', phase: 'out', vid: v.id, legs: 3 + Math.floor(this.rng() * 3) });
    if (t) this.first(k.id, kind, { x: leg[0], z: leg[1] });
  },
  // A run between two stops on the town's streets: stops inside the town and
  // off the railway, along streets that keep clear of the main line
  // (crossing it where they must) and of the highways out of town.
  _transitLeg(v, from) {
    const w = this.world;
    const civ = this.game.civ;
    const rail = civ.railMask;
    const rr = (v.radius || 6) * 1.05;
    const inTown = (i) => {
      const dx = (i % w.w) + 0.5 - v.cx,
        dz = ((i / w.w) | 0) + 0.5 - v.cz;
      return dx * dx + dz * dz < rr * rr;
    };
    const R = v.roadTiles?.filter((i) => !rail?.[i] && inTown(i));
    if (!R?.length) return null;
    for (let tries = 0; tries < 4; tries++) {
      const i1 = R[(this.rng() * R.length) | 0];
      const x1 = (i1 % w.w) + 0.5,
        z1 = ((i1 / w.w) | 0) + 0.5;
      let x0, z0;
      if (from) (x0 = from.x), (z0 = from.z);
      else {
        const i0 = R[(this.rng() * R.length) | 0];
        x0 = (i0 % w.w) + 0.5;
        z0 = ((i0 / w.w) | 0) + 0.5;
      }
      if (Math.hypot(x1 - x0, z1 - z0) < 6) continue;
      const use = civ.use;
      const p = civPath(w, Math.floor(x0), Math.floor(z0), Math.floor(x1), Math.floor(z1), (i) => (use[i] !== USE.ROAD ? Infinity : rail?.[i] ? 9 : inTown(i) ? 1 : 4), 1500, 1);
      if (!p || p.length < 4) continue;
      const path = [x0, z0];
      for (const i of p) path.push((i % w.w) + 0.5, ((i / w.w) | 0) + 0.5);
      return path;
    }
    return null;
  },
  // A rescue helicopter to the worst of a realm's disasters: a town ablaze,
  // its buildings broken, or its people hurt.
  _rescueCall(k) {
    if (this.air.some((f) => f.alive && f.kind === 'helicopter' && f.kingdom === k.id)) return;
    if (this.grounded()) return;
    const civ = this.game.civ;
    const U = this.game.units;
    let best = null,
      bs = 2.5;
    for (const vid of k.villages) {
      const v = civ.villages[vid];
      if (!v?.alive) continue;
      let s = 0,
        at = null;
      for (const b of v.buildings || []) {
        if (!b.alive) continue;
        if (b.burning > 0.3) (s += 1), (at = at || b);
        else if (b.hp < b.maxHp * 0.45 && this.game.time.total - (b.lastHit ?? -1e9) < 60) (s += 0.7), (at = at || b);
      }
      const hurt = U?.query?.(v.cx, v.cz, (v.radius || 6) + 2, (u) => u.alive && u.species === 'human' && u.statuses?.has('wounded'))?.length || 0;
      s += hurt * 0.5;
      if (s > bs) (bs = s), (best = { v, x: at ? at.x : v.cx, z: at ? at.z : v.cz });
    }
    if (!best) return;
    // from a hospital, an airfield or the hall of the nearest town
    let base = null,
      bd = Infinity;
    for (const vid of k.villages) {
      const v = civ.villages[vid];
      if (!v?.alive) continue;
      const b = this._base(v, ['hospital', 'clinic', 'airfield', 'airport', 'healer']);
      if (!b) continue;
      const d = this.dist(b.x, b.z, best.x, best.z);
      if (d < bd) (bd = d), (base = b);
    }
    if (!base || bd > 90) return;
    const f = this.requestFlight({ kind: 'helicopter', kingdom: k.id, from: base.id, to: { x: best.x, z: best.z }, cargo: { rescue: true } });
    if (f) this.note(`🚁 A rescue helicopter of ${this.kname(k.id)} flies to the disaster at ${best.v.name}`, 'info', { x: best.x, z: best.z }, 'rescue' + best.v.id, 90);
  },
  // A civic vehicle has reached where it was going.
  _serviceArrive(v) {
    const m = v.mission;
    if (m.phase === 'home') return false;
    if (m.type === 'fire' || m.type === 'medic') {
      v.state = 'work';
      v.stateT = 0;
      v.speed = 0;
      return true;
    }
    if (m.type === 'transit') {
      v.state = 'work'; // at the stop
      v.stateT = 0;
      v.speed = 0;
      return true;
    }
    if (m.type === 'farm') {
      this.remove(v);
      return true;
    }
    return false;
  },
  _serviceWork(v, step) {
    const m = v.mission;
    const w = this.world;
    if (m.type === 'fire') {
      // hoses on the blaze: the flames die and the burning houses are saved
      if ((m.spray = (m.spray || 0) - step) <= 0) {
        m.spray = 0.5;
        let left = 0;
        const D = this.game.disasters;
        for (let dz = -3; dz <= 3; dz++)
          for (let dx = -3; dx <= 3; dx++) {
            const x = Math.floor(m.tx) + dx,
              z = Math.floor(m.tz) + dz;
            if (!w.inBounds(x, z) || Math.hypot(dx, dz) > 3.2) continue;
            const i = z * w.w + x;
            if (w.fire[i] > 0) {
              if (this.rng() < 0.6) D?.extinguish?.(x, z);
              else left++;
            }
          }
        for (const b of this.game.civ?.villages?.[m.vid]?.buildings || []) {
          if (!b.alive || b.burning <= 0 || this.dist(b.x, b.z, m.tx, m.tz) > 3.5) continue;
          b.burning = Math.max(0, b.burning - 0.35);
          if (b.burning > 0) left++;
        }
        this._fx('splash', m.tx, m.tz, 0.5, { y: Math.max(0, w.heightAt(m.tx, m.tz)) + 0.3 });
        this._fx('steam', m.tx, m.tz, 0.6, { count: 1 });
        if (!m.told) {
          m.told = true;
          this.game.events.emit('fleet:fire', { vehicle: v, kingdom: v.kingdom, village: m.vid, x: m.tx, z: m.tz });
        }
        if (!left && v.stateT > 2) m.done = true;
      }
      if (m.done || v.stateT > 12) this._serviceHome(v);
      return;
    }
    if (m.type === 'medic') {
      if (v.stateT > 3) {
        const U = this.game.units;
        const u = U?.byId?.get(m.patient);
        if (u?.alive) {
          U.heal?.(u, u.maxHp * 0.7);
          u.statuses?.delete('wounded');
          if (u.statuses?.has('sick')) u.statuses.set('sick', Math.min(u.statuses.get('sick'), 6));
          this._fx('heal', u.x, u.z, 0.6);
          this.game.events.emit('fleet:healed', { vehicle: v, kingdom: v.kingdom, unit: u });
        }
        this._serviceHome(v);
      }
      return;
    }
    if (m.type === 'transit') {
      if (v.stateT > 2.5) {
        m.legs--;
        const leg = m.legs > 0 ? this._transitLeg(this.game.civ.villages[m.vid] || {}, { x: v.x, z: v.z }) : null;
        if (!leg) return this.remove(v);
        this.setPath(v, leg);
        v.state = 'move';
      }
    }
  },
  _serviceHome(v) {
    const m = v.mission;
    m.phase = 'home';
    m.siren = false;
    const b = v.base;
    const p = b && this._streetPath(v.x, v.z, b.x, b.z);
    if (!p) return this.remove(v);
    this.setPath(v, p);
    v.state = 'move';
  },

  // ------------------------------------------------------------------ god powers
  // Drop a vehicle of any kind for a realm: a ship on the nearest water (it
  // makes for its realm's harbour), a land vehicle on the nearest dry land
  // (it drives to the nearest town), an aircraft in the air (it flies to its
  // realm's nearest field), a rocket on the spot (it launches at once), a
  // satellite or station straight into orbit.
  spawnVehicle(kind, x, z, kid) {
    const refuse = (why) => {
      this.lastRefusal = why;
      return null;
    };
    const w = this.world;
    const civ = this.game.civ;
    const def = KINDS[kind] || AIR_KINDS[kind];
    if (!def) return refuse('no such vehicle');
    if (!this.kingdom(kid)) return refuse('no realm nearby');
    if (def.cls === 'sea') {
      const p = this.nav.waterNear(x, z, 8, Math.min(1.5, def.clear || 0.5));
      if (!p) return refuse('ships need open water');
      let h = null,
        hd = Infinity;
      for (const o of this.harbours(kid)) {
        if (o.water !== this.nav.comp(p.x, p.z)) continue;
        const d = this.dist(o.x, o.z, p.x, p.z);
        if (d < hd) (hd = d), (h = o);
      }
      const v = this.spawn(kind, kid, p.x, p.z, { home: h?.village ?? -1, harbour: h?.id ?? null, heading: this.rng() * Math.PI * 2 });
      if (!v) return refuse('no ship');
      if (v.role === 'hover') {
        v.state = 'moored';
        return v;
      }
      v.mission = { type: 'home', phase: 'home' };
      if (h) this._goHome(v);
      return v;
    }
    if (def.cls === 'land') {
      const tx = Math.floor(x),
        tz = Math.floor(z);
      let at = w.inBounds(tx, tz) && w.isWalkable(tx, tz) ? { x: tx + 0.5, z: tz + 0.5 } : null;
      for (let r = 1; r < 6 && !at; r++)
        for (let k = 0; k < 8 && !at; k++) {
          const ax = Math.floor(x + Math.cos(k * 0.785) * r),
            az = Math.floor(z + Math.sin(k * 0.785) * r);
          if (w.inBounds(ax, az) && w.isWalkable(ax, az)) at = { x: ax + 0.5, z: az + 0.5 };
        }
      if (!at) return refuse('land vehicles need dry land');
      const town = civ?.villageAt?.(at.x, at.z, 80);
      const goal = town ? this._doorOf(town.hall?.alive ? town.hall : { x: town.cx, z: town.cz }) : null;
      let path = goal ? this._streetPath(at.x, at.z, goal.x, goal.z, 6000) : null;
      if (!path || path.length < 4) path = [at.x, at.z, at.x + 0.6, at.z];
      const v = this.spawn(kind, kid, at.x, at.z, { home: town?.id ?? -1, state: 'move', heading: Math.atan2(path[3] - path[1], path[2] - path[0]) });
      if (!v) return refuse('no vehicle');
      if (def.cars) v.trail = [];
      v.mission = { type: 'drive', phase: 'out', from: town?.id ?? -1, to: town?.id ?? -1, power: true };
      v.voyage = town ? { from: town.id, to: town.id, fromName: town.name, toName: town.name } : null;
      this.setPath(v, path);
      return v;
    }
    if (def.cls === 'air') {
      let best = null,
        bd = Infinity;
      for (const b of this._fields(kid)) {
        const d = this.dist(b.x, b.z, x, z);
        if (d < bd) (bd = d), (best = b);
      }
      const hall = civ?.villageAt?.(x, z, 200)?.hall;
      const dest = def.vtol || !best ? hall : best;
      if (!dest) return refuse('no field to fly to');
      const f = this._airRecord(kind, def, kid, { x, z, building: null }, this._airPoint(dest.id), null);
      f.phase = 'cruise';
      f.y = f.py = Math.max(0, w.heightAt(x, z)) + (def.alt || 5);
      f.speedNow = def.speed;
      f.arc = 0;
      this.first(kid, kind, { x, z });
      return f;
    }
    // space
    if (kind === 'satellite' || kind === 'station') {
      this._reachOrbit({ id: this._nextId++, payload: kind, kingdom: kid, from: { x, z }, alive: true });
      return { kind, x, z, orbit: true };
    }
    const f = this.requestLaunch({ kingdom: kid, from: { x, z }, payload: kind === 'starship' ? 'starship' : 'satellite' });
    if (f) {
      f.y = f.py = f.gy = Math.max(0, w.heightAt(x, z)) + 0.05;
      f.t = 2; // the count is short: it lights at once
    }
    return f;
  },
  solarStormStart(seconds = 60) {
    const now = this.game.time.total;
    this.solarStorm = { start: now, until: now + seconds };
    // satellites tumble; aircraft aloft divert to the nearest field
    for (const o of this.orbit) o.tumble = now + seconds;
    for (const f of this.air) if (f.alive && f.cls === 'air' && f.phase === 'cruise') this._divert(f);
  },
};

