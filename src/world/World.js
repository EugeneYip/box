import { SEA_LEVEL, TILE, TILE_INFO, FLORA, FLORA_INFO, SHALLOW_DEPTH } from './constants.js';

// The authoritative tile grid. Every simulation and rendering module reads
// from here; writers must go through the setters (or call markDirty) so that
// renderers receive 'world:*' events once per frame.
//
// Coordinates: tile (tx, ty) covers world X in [tx, tx+1) and world Z in
// [ty, ty+1). Its centre is (tx + 0.5, ty + 0.5). Y is up. The world spans
// [0, w] x [0, h] on the XZ plane. heightAt() bilinearly interpolates the
// per-tile heights between tile centres; the rendered terrain surface must
// match it so objects placed with heightAt() sit on the ground.
export class World {
  constructor(w, h, events) {
    this.w = w;
    this.h = h;
    this.events = events;
    this.seed = 1;
    const n = w * h;
    this.size = n;
    this.height = new Float32Array(n); // world-space Y of the ground
    this.type = new Uint8Array(n); // TILE id (surface material)
    this.flora = new Uint8Array(n); // FLORA id
    this.floraGrowth = new Float32Array(n); // 0..1 growth stage of the flora
    this.fire = new Float32Array(n); // 0 = not burning, (0..1] intensity
    this.owner = new Int16Array(n).fill(-1); // kingdom id or -1
    this.building = new Int32Array(n).fill(-1); // building id or -1
    this.temperature = new Float32Array(n); // 0 cold .. 1 hot (worldgen)
    this.moisture = new Float32Array(n); // 0 dry .. 1 wet (worldgen)
    this.wetness = new Float32Array(n); // transient rain wetness 0..1 (atmosphere)
    this._dirty = { height: null, type: null, flora: null, owner: null, fire: null };
  }

  // ---- indexing -----------------------------------------------------------
  idx(tx, ty) {
    return ty * this.w + tx;
  }
  inBounds(tx, ty) {
    return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h;
  }
  clampTx(tx) {
    return tx < 0 ? 0 : tx >= this.w ? this.w - 1 : tx;
  }
  clampTy(ty) {
    return ty < 0 ? 0 : ty >= this.h ? this.h - 1 : ty;
  }
  tileOf(x, z) {
    return [this.clampTx(Math.floor(x)), this.clampTy(Math.floor(z))];
  }

  // ---- sampling -----------------------------------------------------------
  getHeight(tx, ty) {
    return this.height[this.idx(this.clampTx(tx), this.clampTy(ty))];
  }
  // Bilinear ground height at a world position (between tile centres).
  heightAt(x, z) {
    const fx = x - 0.5;
    const fz = z - 0.5;
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const tx = fx - x0;
    const tz = fz - z0;
    const h00 = this.getHeight(x0, z0);
    const h10 = this.getHeight(x0 + 1, z0);
    const h01 = this.getHeight(x0, z0 + 1);
    const h11 = this.getHeight(x0 + 1, z0 + 1);
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  }
  // Ground or water surface height (what you would stand on / see).
  surfaceAt(x, z) {
    return Math.max(this.heightAt(x, z), SEA_LEVEL);
  }
  // Approximate surface normal from central differences.
  normalAt(x, z, out = { x: 0, y: 1, z: 0 }) {
    const e = 0.5;
    const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const dz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    const nx = -dx / (2 * e);
    const nz = -dz / (2 * e);
    const len = Math.hypot(nx, 1, nz);
    out.x = nx / len;
    out.y = 1 / len;
    out.z = nz / len;
    return out;
  }
  slopeAt(tx, ty) {
    const h = this.getHeight(tx, ty);
    let m = 0;
    m = Math.max(m, Math.abs(this.getHeight(tx + 1, ty) - h));
    m = Math.max(m, Math.abs(this.getHeight(tx - 1, ty) - h));
    m = Math.max(m, Math.abs(this.getHeight(tx, ty + 1) - h));
    m = Math.max(m, Math.abs(this.getHeight(tx, ty - 1) - h));
    return m;
  }

  // ---- classification -----------------------------------------------------
  isWater(tx, ty) {
    return this.getHeight(tx, ty) < SEA_LEVEL;
  }
  isDeepWater(tx, ty) {
    return this.getHeight(tx, ty) < SEA_LEVEL - SHALLOW_DEPTH;
  }
  isLand(tx, ty) {
    return this.inBounds(tx, ty) && this.getHeight(tx, ty) >= SEA_LEVEL;
  }
  isWalkable(tx, ty) {
    if (!this.inBounds(tx, ty)) return false;
    const i = this.idx(tx, ty);
    if (this.height[i] < SEA_LEVEL) return false;
    if (!TILE_INFO[this.type[i]].walkable) return false;
    if (FLORA_INFO[this.flora[i]].blocksMovement) return false;
    return true;
  }
  isBuildable(tx, ty) {
    if (!this.isWalkable(tx, ty)) return false;
    const i = this.idx(tx, ty);
    if (!TILE_INFO[this.type[i]].buildable) return false;
    if (this.building[i] >= 0) return false;
    if (FLORA_INFO[this.flora[i]].blocksBuilding) return false;
    if (this.slopeAt(tx, ty) > 1.2) return false;
    return true;
  }
  isCoastal(tx, ty) {
    if (this.isWater(tx, ty)) return false;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const x = tx + dx,
          y = ty + dy;
        if (this.inBounds(x, y) && this.isWater(x, y)) return true;
      }
    return false;
  }

  // ---- mutation -----------------------------------------------------------
  setHeight(tx, ty, v) {
    if (!this.inBounds(tx, ty)) return;
    this.height[this.idx(tx, ty)] = v;
    this.markDirty('height', tx, ty);
  }
  setType(tx, ty, t) {
    if (!this.inBounds(tx, ty)) return;
    const i = this.idx(tx, ty);
    if (this.type[i] === t) return;
    this.type[i] = t;
    this.markDirty('type', tx, ty);
  }
  setFlora(tx, ty, f, growth = 1) {
    if (!this.inBounds(tx, ty)) return;
    const i = this.idx(tx, ty);
    this.flora[i] = f;
    this.floraGrowth[i] = f === FLORA.NONE ? 0 : growth;
    this.markDirty('flora', tx, ty);
  }
  setOwner(tx, ty, kingdomId) {
    if (!this.inBounds(tx, ty)) return;
    const i = this.idx(tx, ty);
    if (this.owner[i] === kingdomId) return;
    this.owner[i] = kingdomId;
    this.markDirty('owner', tx, ty);
  }
  setFire(tx, ty, v) {
    if (!this.inBounds(tx, ty)) return;
    this.fire[this.idx(tx, ty)] = v;
    this.markDirty('fire', tx, ty);
  }

  // Expand the dirty rect of a layer. (x1,y1) defaults to (x0,y0).
  markDirty(layer, x0, y0, x1 = x0, y1 = y0) {
    const r = this._dirty[layer];
    if (!r) {
      this._dirty[layer] = { x0, y0, x1, y1 };
    } else {
      if (x0 < r.x0) r.x0 = x0;
      if (y0 < r.y0) r.y0 = y0;
      if (x1 > r.x1) r.x1 = x1;
      if (y1 > r.y1) r.y1 = y1;
    }
  }
  markAllDirty() {
    for (const k of Object.keys(this._dirty)) this.markDirty(k, 0, 0, this.w - 1, this.h - 1);
  }
  // Called once per frame by Game: emits 'world:<layer>' with clamped rects.
  flushDirty() {
    for (const k of Object.keys(this._dirty)) {
      const r = this._dirty[k];
      if (!r) continue;
      this._dirty[k] = null;
      r.x0 = Math.max(0, r.x0);
      r.y0 = Math.max(0, r.y0);
      r.x1 = Math.min(this.w - 1, r.x1);
      r.y1 = Math.min(this.h - 1, r.y1);
      this.events.emit('world:' + k, r);
    }
  }

  // Iterate tiles inside a circle (tile-centre distance <= radius).
  forEachInRadius(cx, cz, radius, fn) {
    const r2 = radius * radius;
    const x0 = Math.max(0, Math.floor(cx - radius));
    const x1 = Math.min(this.w - 1, Math.floor(cx + radius));
    const y0 = Math.max(0, Math.floor(cz - radius));
    const y1 = Math.min(this.h - 1, Math.floor(cz + radius));
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const dx = tx + 0.5 - cx;
        const dz = ty + 0.5 - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 <= r2) fn(tx, ty, Math.sqrt(d2) / Math.max(radius, 1e-6), this.idx(tx, ty));
      }
    }
  }

  // Snapshot for save/load (typed arrays copied).
  serialize() {
    return {
      w: this.w,
      h: this.h,
      seed: this.seed,
      height: this.height.slice(),
      type: this.type.slice(),
      flora: this.flora.slice(),
      floraGrowth: this.floraGrowth.slice(),
      owner: this.owner.slice(),
      temperature: this.temperature.slice(),
      moisture: this.moisture.slice(),
    };
  }
}

export { TILE, FLORA };
