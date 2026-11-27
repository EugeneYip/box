import { SEA_LEVEL, TILE } from '../../world/constants.js';
import { geoWrapOn } from '../../world/geo.js';

const ICE = TILE.ICE; // frozen water: no keel crosses it

// Coarse water navigation for the Fleets module (no three.js: runs headless).
// Open water is a tile below SEA_LEVEL that is not frozen: ships never sail
// through, moor in or berth on an ice sheet. `ice` (a per-tile mask, 1 =
// frozen) is the fleet's view of the sea ice the water shader draws
// (src/world/seaIce.js); without one, ICE tiles are the frozen ones.
//
// The map is cut into C x C tile cells. Each cell that holds water gets one
// node, placed on its most open water tile (farthest from land), so routes
// keep to the middle of channels and rivers. Neighbouring nodes (8-way) are
// linked when the straight run between them stays on water. Union-find
// labels the water bodies (sea, each lake, river systems) so a voyage between
// two of them is refused at once. Works on any rectangle (the 2:1 World Map).
//
//   nav.dist[i]            tiles from water tile i to the nearest land (0 on land)
//   nav.findPath(sx,sz,gx,gz,opts) -> [x0,z0,x1,z1,...] | null   (smoothed polyline)
//   nav.snap(x,z)          the node a water point belongs to (or -1)
//   nav.comp(x,z)          water body id of a point (or -1)
//   nav.markDirty(rect)    terrain changed; nav.update() rebuilds the touched area
//   nav.isWater(x,z), nav.clearAt(x,z), nav.los(ax,az,bx,bz,clear)
// Distances are capped at DMAX tiles, which lets a terrain edit be patched locally.
//
// Round world (docs/ROUND-WORLD.md): on the whole-Earth World Map with the
// setting on (nav.wrap, kept in step by Fleet through setWrap()), the cells
// of the left and right columns are neighbours, so the graph and every
// straight run cross the Atlantic seam. A route that crosses comes back as
// one continuous polyline: its x runs on past 0 or w (say from 1020 to 1030
// on a 1024-wide map), so lengths and headings along it need no special
// care; the vessel following it is moved back onto the map as it crosses
// (Fleet._wrapVessel). Water queries (isWater, clearAt, los, snap) accept
// such off-map x and read the tile the short way round.

const DMAX = 12;
const SQ2 = Math.SQRT2;
// (round 37) cells a voyage search may expand before it is made again along
// a coarse corridor (_coarseRoute); the answer of a search that ran out
const VOY_CAP = 4000;
const CAPPED = -1;
const DIRS = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

export class WaterNav {
  constructor(world, cell = 4, ice = null) {
    this.world = world;
    this.C = cell;
    this.ice = ice;
    this.version = 0;
    this._dirty = null;
    this.wrap = false;
    this.build();
  }

  // Is water tile i frozen over?
  _frozen(i) {
    return this.ice ? this.ice[i] === 1 : this.world.type[i] === ICE;
  }

  // Round world: may the graph cross the seam on this world now?
  _wrapWanted() {
    return geoWrapOn(this.world) && this.world.w % this.C === 0;
  }
  // The setting changed during play: relink the two edge columns.
  setWrap(on = this._wrapWanted()) {
    on = !!on && this.world.w % this.C === 0;
    if (on === this.wrap) return false;
    this.wrap = on;
    this._edgesIn(0, 0, 0, this.ch - 1);
    this._edgesIn(this.cw - 1, 0, this.cw - 1, this.ch - 1);
    this._components();
    this.version++;
    return true;
  }
  // x the short way round (wrap on), or unchanged
  _sdx(dx) {
    if (!this.wrap) return dx;
    const W = this.W;
    return dx > W / 2 ? dx - W : dx < -W / 2 ? dx + W : dx;
  }
  // tile column on the map for any tile x (wrap on), or unchanged
  _tx(tx) {
    return this.wrap && (tx < 0 || tx >= this.W) ? ((tx % this.W) + this.W) % this.W : tx;
  }
  // neighbouring cell in direction k, across the seam when wrap is on; -1 off the map
  _nb(cx, cy, k) {
    let nx = cx + DIRS[k][0];
    const ny = cy + DIRS[k][1];
    if (ny < 0 || ny >= this.ch) return -1;
    if (nx < 0 || nx >= this.cw) {
      if (!this.wrap) return -1;
      nx = nx < 0 ? nx + this.cw : nx - this.cw;
    }
    return ny * this.cw + nx;
  }
  // A polyline made continuous for a wrapped world: each point's x is moved by
  // whole map widths to lie within half a map of the previous one (in place).
  unwrap(p, from = 0) {
    if (!this.wrap || !p) return p;
    const W = this.W;
    for (let i = Math.max(2, from + 2); i < p.length; i += 2) {
      const prev = p[i - 2];
      let x = p[i];
      while (x - prev > W / 2) x -= W;
      while (x - prev < -W / 2) x += W;
      p[i] = x;
    }
    return p;
  }

  // ------------------------------------------------------------------ build
  build() {
    const w = this.world;
    const C = this.C;
    this.W = w.w;
    this.H = w.h;
    this.cw = Math.ceil(w.w / C);
    this.ch = Math.ceil(w.h / C);
    this.wrap = this._wrapWanted();
    const n = this.cw * this.ch;
    this.dist = new Float32Array(w.w * w.h);
    this.nx = new Float32Array(n);
    this.nz = new Float32Array(n);
    this.nd = new Float32Array(n); // clearance at the node
    this.ntile = new Int32Array(n).fill(-1);
    this.edges = new Uint8Array(n);
    this.compOf = new Int32Array(n).fill(-1);
    this.compSize = new Map();
    // A* scratch
    this._g = new Float32Array(n);
    this._from = new Int32Array(n);
    this._seen = new Uint32Array(n);
    this._done = new Uint32Array(n);
    this._stamp = 0;
    this._heapI = new Int32Array(1024);
    this._heapF = new Float32Array(1024);
    this._cellMark = new Uint8Array(C * C);
    this._cellStack = new Int32Array(C * C);
    this._distRect(0, 0, w.w - 1, w.h - 1);
    this._cells(0, 0, this.cw - 1, this.ch - 1);
    this._edgesIn(0, 0, this.cw - 1, this.ch - 1);
    this._components();
    this.version++;
    this._dirty = null;
  }

  markDirty(r) {
    if (!r) return;
    const d = this._dirty;
    if (!d) this._dirty = { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 };
    else {
      d.x0 = Math.min(d.x0, r.x0);
      d.y0 = Math.min(d.y0, r.y0);
      d.x1 = Math.max(d.x1, r.x1);
      d.y1 = Math.max(d.y1, r.y1);
    }
  }
  get dirty() {
    return !!this._dirty;
  }

  // Patch the graph around the last terrain edits. Returns the touched rect.
  update() {
    const r = this._dirty;
    if (!r) return null;
    this._dirty = null;
    const W = this.W,
      H = this.H,
      C = this.C;
    // a big edit (regenerated world) rebuilds everything
    if ((r.x1 - r.x0) * (r.y1 - r.y0) > W * H * 0.5) {
      this.build();
      return { x0: 0, y0: 0, x1: W - 1, y1: H - 1 };
    }
    const x0 = Math.max(0, r.x0 - DMAX),
      y0 = Math.max(0, r.y0 - DMAX),
      x1 = Math.min(W - 1, r.x1 + DMAX),
      y1 = Math.min(H - 1, r.y1 + DMAX);
    this._distRect(x0, y0, x1, y1, r);
    const cx0 = Math.max(0, Math.floor(x0 / C) - 1),
      cy0 = Math.max(0, Math.floor(y0 / C) - 1),
      cx1 = Math.min(this.cw - 1, Math.floor(x1 / C) + 1),
      cy1 = Math.min(this.ch - 1, Math.floor(y1 / C) + 1);
    // the cells whose links are made again (the touched cells and their neighbours)
    const E = { x0: Math.max(0, cx0 - 1), y0: Math.max(0, cy0 - 1), x1: Math.min(this.cw - 1, cx1 + 1), y1: Math.min(this.ch - 1, cy1 + 1) };
    const snap = globalThis.__navFullComp ? null : this._snapEdges(E);
    this._cells(cx0, cy0, cx1, cy1);
    this._edgesIn(E.x0, E.y0, E.x1, E.y1);
    // (round 37) the water bodies are labelled again only round the patch
    // (a whole relabel took 50-60 ms on Medium and up to half a second on
    // the Vast World Map in the round-36 profiles, every few seconds while
    // the sea ice formed); a body the patch may have cut in two, where a
    // short search cannot tell, is labelled again whole
    if (!snap || !this._componentsPatch(E, snap)) this._components();
    this._dropRoutes(E);
    this.version++;
    return { x0, y0, x1, y1 };
  }

  // The links and water nodes of a cell window, kept before it is patched.
  _snapEdges(E) {
    const cw = this.cw;
    const bw = E.x1 - E.x0 + 1,
      bh = E.y1 - E.y0 + 1;
    const e = new Uint8Array(bw * bh),
      wet = new Uint8Array(bw * bh);
    for (let y = 0; y < bh; y++)
      for (let x = 0; x < bw; x++) {
        const c = (E.y0 + y) * cw + E.x0 + x;
        e[y * bw + x] = this.edges[c];
        wet[y * bw + x] = this.ntile[c] >= 0 ? 1 : 0;
      }
    return { e, wet, bw };
  }

  // Cached routes that pass through a patched window (or found no way) are
  // dropped; the rest stand (round 37: every patch threw all of them away,
  // and on the Vast World Map the sea ice patches the graph every few
  // seconds, so ships searched the same oceans again and again).
  _dropRoutes(E) {
    const AC = this._acache;
    if (!AC || this._acacheV !== this.version) return;
    for (const [k, r] of AC) if (!r || (r.bx1 >= E.x0 && r.bx0 <= E.x1 && r.by1 >= E.y0 && r.by0 <= E.y1)) AC.delete(k);
    this._acacheV = this.version + 1;
  }

  // Chamfer distance to land (tiles), capped at DMAX. With `inner`, the pass
  // runs over the window but writes back only within `inner` grown by DMAX.
  _distRect(x0, y0, x1, y1, inner = null) {
    const w = this.world;
    const W = this.W;
    const h = w.height,
      ty = w.type;
    const bw = x1 - x0 + 1,
      bh = y1 - y0 + 1;
    const f = new Float32Array(bw * bh);
    for (let y = 0; y < bh; y++)
      for (let x = 0; x < bw; x++) {
        const i = (y0 + y) * W + x0 + x;
        f[y * bw + x] = h[i] < SEA_LEVEL && !this._frozen(i) ? DMAX : 0;
      }
    // forward
    for (let y = 0; y < bh; y++)
      for (let x = 0; x < bw; x++) {
        const k = y * bw + x;
        let v = f[k];
        if (v === 0) continue;
        if (x > 0) v = Math.min(v, f[k - 1] + 1);
        if (y > 0) {
          v = Math.min(v, f[k - bw] + 1);
          if (x > 0) v = Math.min(v, f[k - bw - 1] + SQ2);
          if (x < bw - 1) v = Math.min(v, f[k - bw + 1] + SQ2);
        }
        f[k] = v;
      }
    // backward
    for (let y = bh - 1; y >= 0; y--)
      for (let x = bw - 1; x >= 0; x--) {
        const k = y * bw + x;
        let v = f[k];
        if (v === 0) continue;
        if (x < bw - 1) v = Math.min(v, f[k + 1] + 1);
        if (y < bh - 1) {
          v = Math.min(v, f[k + bw] + 1);
          if (x < bw - 1) v = Math.min(v, f[k + bw + 1] + SQ2);
          if (x > 0) v = Math.min(v, f[k + bw - 1] + SQ2);
        }
        f[k] = v;
      }
    let ix0 = x0,
      iy0 = y0,
      ix1 = x1,
      iy1 = y1;
    if (inner) {
      ix0 = Math.max(x0, inner.x0 - DMAX);
      iy0 = Math.max(y0, inner.y0 - DMAX);
      ix1 = Math.min(x1, inner.x1 + DMAX);
      iy1 = Math.min(y1, inner.y1 + DMAX);
    }
    const d = this.dist;
    for (let y = iy0; y <= iy1; y++)
      for (let x = ix0; x <= ix1; x++) d[y * W + x] = f[(y - y0) * bw + x - x0];
  }

  // One node per cell, on the most open tile of its largest water patch.
  _cells(cx0, cy0, cx1, cy1) {
    const C = this.C,
      W = this.W,
      H = this.H;
    const d = this.dist;
    const mark = this._cellMark,
      st = this._cellStack;
    for (let cy = cy0; cy <= cy1; cy++)
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = cy * this.cw + cx;
        const tx0 = cx * C,
          ty0 = cy * C;
        const tw = Math.min(C, W - tx0),
          th = Math.min(C, H - ty0);
        mark.fill(0);
        let bestN = 0,
          bestTile = -1,
          bestD = -1;
        let label = 0;
        for (let ly = 0; ly < th; ly++)
          for (let lx = 0; lx < tw; lx++) {
            const li = ly * C + lx;
            if (mark[li] || d[(ty0 + ly) * W + tx0 + lx] <= 0) continue;
            // flood this water patch inside the cell
            label++;
            let sp = 0,
              n = 0,
              pt = -1,
              pd = -1,
              pc = 1e9;
            st[sp++] = li;
            mark[li] = 1;
            while (sp) {
              const q = st[--sp];
              const qx = q % C,
                qy = (q / C) | 0;
              const ti = (ty0 + qy) * W + tx0 + qx;
              n++;
              const dd = d[ti];
              const cc = Math.abs(qx + 0.5 - tw / 2) + Math.abs(qy + 0.5 - th / 2);
              if (dd > pd + 1e-3 || (Math.abs(dd - pd) <= 1e-3 && cc < pc)) {
                pd = dd;
                pt = ti;
                pc = cc;
              }
              if (qx > 0 && !mark[q - 1] && d[ti - 1] > 0) (mark[q - 1] = 1), (st[sp++] = q - 1);
              if (qx < tw - 1 && !mark[q + 1] && d[ti + 1] > 0) (mark[q + 1] = 1), (st[sp++] = q + 1);
              if (qy > 0 && !mark[q - C] && d[ti - W] > 0) (mark[q - C] = 1), (st[sp++] = q - C);
              if (qy < th - 1 && !mark[q + C] && d[ti + W] > 0) (mark[q + C] = 1), (st[sp++] = q + C);
            }
            if (n > bestN || (n === bestN && pd > bestD)) {
              bestN = n;
              bestTile = pt;
              bestD = pd;
            }
          }
        void label;
        this.ntile[c] = bestTile;
        if (bestTile >= 0) {
          this.nx[c] = (bestTile % W) + 0.5;
          this.nz[c] = ((bestTile / W) | 0) + 0.5;
          this.nd[c] = bestD;
        } else this.nd[c] = 0;
      }
  }

  _edgesIn(cx0, cy0, cx1, cy1) {
    const cw = this.cw,
      ch = this.ch;
    void ch;
    // clear the bits of these cells (and the matching bits of outside neighbours)
    // (neighbours run across the seam when the world wraps)
    for (let cy = cy0; cy <= cy1; cy++)
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = cy * cw + cx;
        this.edges[c] = 0;
        for (let k = 0; k < 8; k++) {
          const o = this._nb(cx, cy, k);
          if (o < 0) continue;
          const nx = o % cw,
            ny = (o / cw) | 0;
          if (nx >= cx0 && nx <= cx1 && ny >= cy0 && ny <= cy1) continue;
          this.edges[o] &= ~(1 << ((k + 4) & 7));
        }
      }
    for (let cy = cy0; cy <= cy1; cy++)
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = cy * cw + cx;
        if (this.ntile[c] < 0) continue;
        for (let k = 0; k < 8; k++) {
          const o = this._nb(cx, cy, k);
          if (o < 0) continue;
          if (this.ntile[o] < 0) continue;
          if (this.edges[c] & (1 << k)) continue;
          if (!this.los(this.nx[c], this.nz[c], this.nx[o], this.nz[o], 0)) continue;
          this.edges[c] |= 1 << k;
          this.edges[o] |= 1 << ((k + 4) & 7);
        }
      }
  }

  // the cell linked to cell c in direction k (the link bit is set, so the
  // neighbour exists; across the seam when the world wraps)
  _lk(c, k) {
    const cw = this.cw;
    const cx = c % cw;
    let nx = cx + DIRS[k][0];
    if (nx < 0) nx += cw;
    else if (nx >= cw) nx -= cw;
    return c + DIRS[k][1] * cw + nx - cx;
  }

  _components() {
    const n = this.cw * this.ch;
    const cw = this.cw;
    const comp = this.compOf;
    const edges = this.edges,
      ntile = this.ntile;
    comp.fill(-1);
    this.compSize = new Map();
    const stack = this._compStack && this._compStack.length >= n ? this._compStack : (this._compStack = new Int32Array(n));
    let next = 0;
    for (let s = 0; s < n; s++) {
      if (comp[s] !== -1 || ntile[s] < 0) continue;
      let sp = 0,
        size = 0;
      stack[sp++] = s;
      comp[s] = next;
      while (sp) {
        const c = stack[--sp];
        size++;
        const e = edges[c];
        if (!e) continue;
        const cx = c % cw;
        for (let k = 0; k < 8; k++) {
          if (!(e & (1 << k))) continue;
          // (a set bit always has a neighbour: off the side only with the seam)
          let nx = cx + DIRS[k][0];
          if (nx < 0) nx += cw;
          else if (nx >= cw) nx -= cw;
          const o = c + DIRS[k][1] * cw + nx - cx;
          if (comp[o] === -1) {
            comp[o] = next;
            stack[sp++] = o;
          }
        }
      }
      this.compSize.set(next, size);
      next++;
    }
    this._nextComp = next;
  }

  // Water bodies after a patch of the cell window E, from the old labels and
  // the links the window had before (snap). Links that went (and water
  // nodes that froze or dried) are checked with a short search: if the two
  // sides still meet, nothing changed; if one side turns out to be a small
  // body of its own, it gets a new label. New links join the bodies they
  // touch (the smaller is relabelled). Returns false when a search runs out
  // before it can tell (a big body may have been cut in two): the caller
  // then labels everything again.
  _componentsPatch(E, snap) {
    if (this._nextComp == null) return false;
    const cw = this.cw;
    const n = cw * this.ch;
    const comp = this.compOf,
      edges = this.edges,
      ntile = this.ntile,
      size = this.compSize;
    const { e: oldE, wet: oldWet, bw } = snap;
    const inE = (c) => {
      const x = c % cw,
        y = (c / cw) | 0;
      return x >= E.x0 && x <= E.x1 && y >= E.y0 && y <= E.y1;
    };
    const sz = (l) => size.get(l) || 0;
    const addSize = (l, d) => {
      const s = sz(l) + d;
      if (s > 0) size.set(l, s);
      else size.delete(l);
    };
    // 1. groups of cells that must still meet: the two ends of a link that
    // went, and the remaining water neighbours of a node that went
    const groups = [];
    const gone = new Map(); // nodes that went -> their old links
    for (let y = E.y0; y <= E.y1; y++)
      for (let x = E.x0; x <= E.x1; x++) {
        const c = y * cw + x;
        const j = (y - E.y0) * bw + x - E.x0;
        if (oldWet[j] && ntile[c] < 0) {
          gone.set(c, oldE[j]);
          if (comp[c] >= 0) addSize(comp[c], -1);
          comp[c] = -1;
        }
      }
    // nodes that went, in clusters linked before: the water each cluster
    // touched must still meet (a route through the cluster went round it)
    if (gone.size) {
      const done = new Set();
      for (const r0 of gone.keys()) {
        if (done.has(r0)) continue;
        done.add(r0);
        const st = [r0],
          g = new Set();
        while (st.length) {
          const r = st.pop();
          const was = gone.get(r);
          for (let k = 0; k < 8; k++) {
            if (!(was & (1 << k))) continue;
            const o = this._lk(r, k);
            if (gone.has(o)) {
              if (!done.has(o)) done.add(o), st.push(o);
            } else if (ntile[o] >= 0) g.add(o);
          }
        }
        if (g.size > 1) groups.push([...g]);
      }
    }
    for (let y = E.y0; y <= E.y1; y++)
      for (let x = E.x0; x <= E.x1; x++) {
        const c = y * cw + x;
        const j = (y - E.y0) * bw + x - E.x0;
        const was = oldE[j];
        const wetNow = ntile[c] >= 0;
        if (!wetNow || !oldWet[j]) continue;
        const gone = was & ~edges[c];
        if (!gone) continue;
        for (let k = 0; k < 8; k++) {
          if (!(gone & (1 << k))) continue;
          const o = this._lk(c, k);
          if (ntile[o] < 0) continue; // (that node went: its own group)
          if (inE(o) && o < c) continue; // (seen from the other end)
          groups.push([c, o]);
        }
      }
    // 2. check each group with bounded searches over the links as they are now
    const LIM = 3000;
    const mark = this._pmark && this._pmark.length >= n ? this._pmark : (this._pmark = new Uint32Array(n));
    const q = this._pq && this._pq.length >= n ? this._pq : (this._pq = new Int32Array(n));
    let stamp = this._pstamp || 0;
    // breadth-first from s until every target is reached (1), the body is
    // exhausted (0: q[0..qn) holds it), or the limit (-1)
    let qn = 0;
    const search = (s, targets) => {
      if (++stamp >= 0xfffffff0) {
        mark.fill(0);
        stamp = 1;
      }
      const want = new Set(targets);
      want.delete(s);
      let left = want.size;
      qn = 0;
      if (!left) return 1;
      q[qn++] = s;
      mark[s] = stamp;
      let h = 0;
      while (h < qn) {
        const c = q[h++];
        const e = edges[c];
        if (!e) continue;
        for (let k = 0; k < 8; k++) {
          if (!(e & (1 << k))) continue;
          const o = this._lk(c, k);
          if (mark[o] === stamp) continue;
          mark[o] = stamp;
          if (want.has(o) && --left === 0) return 1;
          if (qn >= LIM) return -1;
          q[qn++] = o;
        }
      }
      return 0;
    };
    // Each group: the members still meet, or some lie in small bodies of
    // their own (split off with new labels) and the rest still meet. A route
    // that ran through a split-off body went on to the water beyond it on
    // other sides: the remaining members of every group that split a body
    // off must all still meet as well (else the patch gives up).
    const firstNew = this._nextComp;
    const reps = [];
    const check = (g, final) => {
      g = g.filter((c) => ntile[c] >= 0);
      let tried = 0,
        split = false;
      while (g.length > 1 && tried < g.length) {
        const s = g[tried];
        const r = search(s, g);
        if (r === 1) break; // all still meet
        if (r === -1) {
          tried++; // too big to tell from here: try from another member
          continue;
        }
        if (final) return false;
        // s lies in a small body of its own now: it takes a new label (once)
        split = true;
        if (comp[s] < firstNew) {
          const L = this._nextComp++;
          for (let i = 0; i < qn; i++) {
            const c = q[i];
            if (comp[c] >= 0) addSize(comp[c], -1);
            comp[c] = L;
          }
          size.set(L, qn);
        }
        const rest = [];
        for (const c of g) if (mark[c] !== stamp) rest.push(c);
        g = rest;
        tried = 0;
      }
      if (g.length > 1 && tried >= g.length) return false;
      if (split && g.length) reps.push(g[0]);
      return true;
    };
    let ok = true;
    for (const g of groups) if (!(ok = check(g, false))) break;
    if (ok && reps.length > 1) ok = check(reps, true);
    if (!ok) {
      this._pstamp = stamp;
      return false;
    }
    // 3. new water nodes and new links: join the bodies they touch
    const relabel = (s, from, to) => {
      // every cell of body `from` that meets s through cells of `from`
      let sp = 0,
        cnt = 0;
      q[sp++] = s;
      comp[s] = to;
      while (sp) {
        const c = q[--sp];
        cnt++;
        const e = edges[c];
        if (!e) continue;
        for (let k = 0; k < 8; k++) {
          if (!(e & (1 << k))) continue;
          const o = this._lk(c, k);
          if (comp[o] !== from) continue;
          comp[o] = to;
          q[sp++] = o;
        }
      }
      return cnt;
    };
    const added = [];
    for (let y = E.y0; y <= E.y1; y++)
      for (let x = E.x0; x <= E.x1; x++) {
        const c = y * cw + x;
        if (ntile[c] < 0) continue;
        if (comp[c] < 0) {
          const L = this._nextComp++;
          comp[c] = L;
          size.set(L, 1);
        }
        const j = (y - E.y0) * bw + x - E.x0;
        const add = edges[c] & ~(oldWet[j] ? oldE[j] : 0);
        if (!add) continue;
        for (let k = 0; k < 8; k++) if (add & (1 << k)) added.push(c, this._lk(c, k));
      }
    // (until every new link joins one label: a body whose cells meet only
    // through another may need more than one pass)
    for (let changed = true; changed; ) {
      changed = false;
      for (let i = 0; i < added.length; i += 2) {
        const c = added[i],
          o = added[i + 1];
        const A = comp[c],
          B = comp[o];
        if (A === B || A < 0 || B < 0) continue;
        // the smaller body takes the larger's label
        const big = sz(A) >= sz(B);
        const keep = big ? A : B,
          lose = big ? B : A;
        const cnt = relabel(big ? o : c, lose, keep);
        addSize(lose, -cnt);
        addSize(keep, cnt);
        changed = true;
      }
    }
    this._pstamp = stamp;
    return true;
  }

  // ------------------------------------------------------------------ queries
  isWater(x, z) {
    const tx = this._tx(Math.floor(x)),
      tz = Math.floor(z);
    if (tx < 0 || tz < 0 || tx >= this.W || tz >= this.H) return false;
    const i = tz * this.W + tx;
    return this.world.height[i] < SEA_LEVEL && !this._frozen(i);
  }
  clearAt(x, z) {
    const tx = this._tx(Math.floor(x)),
      tz = Math.floor(z);
    if (tx < 0 || tz < 0 || tx >= this.W || tz >= this.H) return 0;
    const i = tz * this.W + tx;
    if (this.world.height[i] >= SEA_LEVEL || this._frozen(i)) return 0;
    return this.dist[i];
  }
  cellAt(x, z) {
    const cx = Math.min(this.cw - 1, Math.max(0, Math.floor(this._tx(Math.floor(x)) / this.C))),
      cy = Math.min(this.ch - 1, Math.max(0, Math.floor(z / this.C)));
    return cy * this.cw + cx;
  }

  // Straight run on water. clear > 0 also asks for that much open water.
  los(ax, az, bx, bz, clear = 0) {
    const dx = this._sdx(bx - ax),
      dz = bz - az;
    const wrap = this.wrap;
    const L = Math.hypot(dx, dz);
    const n = Math.max(1, Math.ceil(L / 0.3));
    const W = this.W,
      H = this.H;
    const h = this.world.height,
      ty = this.world.type,
      d = this.dist;
    for (let s = 0; s <= n; s++) {
      const t = s / n;
      let tx = Math.floor(ax + dx * t);
      const tz = Math.floor(az + dz * t);
      if (wrap && (tx < 0 || tx >= W)) tx = ((tx % W) + W) % W;
      if (tx < 0 || tz < 0 || tx >= W || tz >= H) return false;
      const i = tz * W + tx;
      if (h[i] >= SEA_LEVEL || this._frozen(i)) return false;
      if (clear > 0 && d[i] < clear && s > 0 && s < n) return false;
    }
    return true;
  }

  // The node a water point attaches to (direct line), or -1.
  snap(x, z) {
    const C = this.C;
    if (this.wrap && (x < 0 || x >= this.W)) x = ((x % this.W) + this.W) % this.W;
    const cx = Math.floor(x / C),
      cy = Math.floor(z / C);
    let best = -1,
      bd = Infinity;
    for (let r = 0; r <= 2 && best < 0; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          let nx = cx + dx;
          const ny = cy + dy;
          if (this.wrap && (nx < 0 || nx >= this.cw)) nx = nx < 0 ? nx + this.cw : nx - this.cw;
          if (nx < 0 || ny < 0 || nx >= this.cw || ny >= this.ch) continue;
          const c = ny * this.cw + nx;
          if (this.ntile[c] < 0 || this.compOf[c] < 0) continue;
          const dd = Math.hypot(this._sdx(this.nx[c] - x), this.nz[c] - z);
          if (dd >= bd) continue;
          if (!this.los(x, z, this.nx[c], this.nz[c], 0)) continue;
          bd = dd;
          best = c;
        }
    return best;
  }

  comp(x, z) {
    const c = this.snap(x, z);
    if (c >= 0) return this.compOf[c];
    const s = this._localToNode(x, z, 8);
    return s ? this.compOf[s.cell] : -1;
  }

  // Tile BFS over water to the nearest node tile (for berths in nooks).
  _localToNode(x, z, R = 10) {
    const W = this.W,
      H = this.H;
    const wrap = this.wrap;
    if (wrap && (x < 0 || x >= W)) x = ((x % W) + W) % W;
    const tx0 = Math.floor(x),
      tz0 = Math.floor(z);
    if (tx0 < 0 || tz0 < 0 || tx0 >= W || tz0 >= H) return null;
    const h = this.world.height,
      ty = this.world.type;
    const dry = (i) => h[i] >= SEA_LEVEL || this._frozen(i);
    // (tile x on the map: across the seam when the world wraps)
    const mx = (t) => (wrap && (t < 0 || t >= W) ? ((t % W) + W) % W : t);
    if (dry(tz0 * W + tx0)) return null;
    const S = R * 2 + 1;
    const prev = new Int32Array(S * S).fill(-2);
    const q = new Int32Array(S * S);
    let qh = 0,
      qt = 0;
    const start = R * S + R;
    prev[start] = -1;
    q[qt++] = start;
    const C = this.C;
    while (qh < qt) {
      const k = q[qh++];
      const lx = k % S,
        lz = (k / S) | 0;
      const tx = mx(tx0 + lx - R),
        tz = tz0 + lz - R;
      const ti = tz * W + tx;
      const c = Math.floor(tz / C) * this.cw + Math.floor(tx / C);
      if (this.ntile[c] === ti && this.compOf[c] >= 0) {
        const pts = [];
        for (let p = k; p !== -1; p = prev[p]) pts.push(tx0 + (p % S) - R + 0.5, tz0 + ((p / S) | 0) - R + 0.5);
        // pts runs node -> start; reverse into start -> node
        const out = [];
        for (let i = pts.length - 2; i >= 0; i -= 2) out.push(pts[i], pts[i + 1]);
        return { cell: c, pts: out };
      }
      for (let dd = 0; dd < 8; dd++) {
        const nx = lx + DIRS[dd][0],
          nz = lz + DIRS[dd][1];
        if (nx < 0 || nz < 0 || nx >= S || nz >= S) continue;
        const nk = nz * S + nx;
        if (prev[nk] !== -2) continue;
        const ttx = mx(tx0 + nx - R),
          ttz = tz0 + nz - R;
        if (ttx < 0 || ttz < 0 || ttx >= W || ttz >= H) continue;
        if (dry(ttz * W + ttx)) continue;
        if (dd & 1) {
          // no diagonal squeeze between two land tiles
          if (dry(tz * W + ttx) && dry(ttz * W + tx)) continue;
        }
        prev[nk] = k;
        q[qt++] = nk;
      }
    }
    return null;
  }

  // Attach a point to the graph: direct line or a short tile route.
  _attach(x, z) {
    const c = this.snap(x, z);
    if (c >= 0) return { cell: c, pts: [] };
    return this._localToNode(x, z, 10);
  }

  // Smoothed water route between two water points. opts: {big (prefer open
  // water), minClear (never use narrower water, except near the two ends),
  // maxLen (tiles; refuse longer), clear (clearance kept when smoothing)}.
  findPath(sx, sz, gx, gz, opts = {}) {
    if (!this.isWater(sx, sz) || !this.isWater(gx, gz)) return null;
    // short hops in plain sight need no graph (the goal taken the short way
    // round when the world wraps, so the hop is one continuous line)
    const gxs = sx + this._sdx(gx - sx);
    const dd = Math.hypot(gxs - sx, gz - sz);
    if (dd < this.C * 3 && this.los(sx, sz, gxs, gz, 0)) return [sx, sz, gxs, gz];
    if (dd < 48 && this.los(sx, sz, gxs, gz, Math.max(1, opts.minClear || 0))) return [sx, sz, gxs, gz];
    const a = this._attach(sx, sz);
    const b = this._attach(gx, gz);
    if (!a || !b) return null;
    if (this.compOf[a.cell] !== this.compOf[b.cell]) return null;
    // (ships ply the same few routes between the same harbours: a route
    // between two cells is kept until the water graph changes; read only)
    const big = !!opts.big,
      mc = opts.minClear || 0;
    let AC = this._acache;
    if (!AC || this._acacheV !== this.version || AC.size > 3000) {
      AC = this._acache = new Map();
      this._acacheV = this.version;
    }
    const ak = a.cell + ',' + b.cell + (big ? ',b,' : ',s,') + mc;
    let hit = AC.get(ak);
    if (hit === undefined) {
      // (round 37) a search may expand only so many cells (one voyage search
      // took 107 ms on the Vast World Map); one that runs out is made again
      // along a corridor of the route found on a coarser grid
      let found = this._astar(a.cell, b.cell, big, mc, globalThis.__navCapOff ? 0 : VOY_CAP);
      if (found === CAPPED) found = this._coarseRoute(a.cell, b.cell, big, mc);
      hit = found ? this._routeEntry(found) : null;
      AC.set(ak, hit);
    }
    if (!hit) return null;
    const cells = hit.cells;
    const raw = [sx, sz, ...a.pts];
    for (const c of cells) raw.push(this.nx[c], this.nz[c]);
    // b.pts runs goal -> node: append reversed (node -> goal)
    for (let i = b.pts.length - 2; i >= 0; i -= 2) raw.push(b.pts[i], b.pts[i + 1]);
    raw.push(gx, gz);
    this.unwrap(raw); // one continuous line across the seam
    const path = this.smooth(raw, opts.clear ?? Math.max(opts.big ? 2 : 1.4, opts.minClear || 0));
    if (opts.maxLen && pathLength(path) > opts.maxLen) return null;
    return path;
  }

  // Greedy string-pulling: skip ahead to the farthest point in clear sight.
  smooth(raw, clear = 1.4) {
    const n = raw.length / 2;
    if (n <= 2) return raw.slice();
    const out = [raw[0], raw[1]];
    let i = 0;
    while (i < n - 1) {
      let j = Math.min(n - 1, i + 28);
      for (; j > i + 1; j--) {
        if (this.los(raw[i * 2], raw[i * 2 + 1], raw[j * 2], raw[j * 2 + 1], clear) || (j - i <= 3 && this.los(raw[i * 2], raw[i * 2 + 1], raw[j * 2], raw[j * 2 + 1], 0))) break;
      }
      out.push(raw[j * 2], raw[j * 2 + 1]);
      i = j;
    }
    // drop zero-length steps
    const clean = [out[0], out[1]];
    for (let k = 2; k < out.length; k += 2) {
      const px = clean[clean.length - 2],
        pz = clean[clean.length - 1];
      if (Math.hypot(out[k] - px, out[k + 1] - pz) > 0.05) clean.push(out[k], out[k + 1]);
    }
    return clean;
  }

  // cap > 0: give up after expanding that many cells, returning CAPPED.
  // corr: only cells in the marked blocks of a coarse corridor are searched.
  _astar(s, g, big, minClear = 0, cap = 0, corr = null) {
    const cw = this.cw;
    const sx0 = s % cw,
      sy0 = (s / cw) | 0,
      gx0 = g % cw,
      gy0 = (g / cw) | 0;
    // within two cells of either end a ship may use narrower water (harbour mouths)
    const wrap = this.wrap;
    const cdx = (a, b) => {
      const d = Math.abs(a - b);
      return wrap ? Math.min(d, cw - d) : d;
    };
    const nearEnd = (c) => {
      const x = c % cw,
        y = (c / cw) | 0;
      return Math.max(cdx(x, sx0), Math.abs(y - sy0)) <= 2 || Math.max(cdx(x, gx0), Math.abs(y - gy0)) <= 2;
    };
    const stamp = ++this._stamp;
    const G = this._g,
      from = this._from,
      seen = this._seen,
      done = this._done;
    let heapN = 0;
    const gx = g % cw,
      gy = (g / cw) | 0;
    const hk = this.C;
    const hfn = (c) => {
      const dx = cdx(c % cw, gx),
        dy = Math.abs(((c / cw) | 0) - gy);
      return (dx + dy + (SQ2 - 2) * Math.min(dx, dy)) * hk;
    };
    const push = (i, f) => {
      if (heapN >= this._heapI.length) {
        const ni = new Int32Array(this._heapI.length * 2);
        ni.set(this._heapI);
        this._heapI = ni;
        const nf = new Float32Array(this._heapF.length * 2);
        nf.set(this._heapF);
        this._heapF = nf;
      }
      const HI = this._heapI,
        HF = this._heapF;
      let c = heapN++;
      while (c > 0) {
        const p = (c - 1) >> 1;
        if (HF[p] <= f) break;
        HI[c] = HI[p];
        HF[c] = HF[p];
        c = p;
      }
      HI[c] = i;
      HF[c] = f;
    };
    const pop = () => {
      const HI = this._heapI,
        HF = this._heapF;
      const top = HI[0];
      const li = HI[--heapN],
        lf = HF[heapN];
      let c = 0;
      for (;;) {
        const l = c * 2 + 1;
        if (l >= heapN) break;
        let m = l;
        if (l + 1 < heapN && HF[l + 1] < HF[l]) m = l + 1;
        if (HF[m] >= lf) break;
        HI[c] = HI[m];
        HF[c] = HF[m];
        c = m;
      }
      HI[c] = li;
      HF[c] = lf;
      return top;
    };
    seen[s] = stamp;
    G[s] = 0;
    from[s] = -1;
    push(s, hfn(s));
    let found = false;
    let expanded = 0;
    while (heapN) {
      const c = pop();
      if (done[c] === stamp) continue;
      done[c] = stamp;
      if (c === g) {
        found = true;
        break;
      }
      if (++expanded > (minClear > 0 ? 24000 : 60000)) break;
      if (cap && expanded > cap) return CAPPED;
      const e = this.edges[c];
      if (!e) continue;
      const cx = c % cw,
        cy = (c / cw) | 0;
      const dc = this.nd[c];
      for (let k = 0; k < 8; k++) {
        if (!(e & (1 << k))) continue;
        const o = wrap ? this._nb(cx, cy, k) : (cy + DIRS[k][1]) * cw + cx + DIRS[k][0];
        if (o < 0 || done[o] === stamp) continue;
        if (corr && corr.mark[(((o / cw) | 0) >> 2) * corr.bw + ((o % cw) >> 2)] !== corr.stamp) continue;
        const len = Math.hypot(wrap ? this._sdx(this.nx[o] - this.nx[c]) : this.nx[o] - this.nx[c], this.nz[o] - this.nz[c]);
        const md = Math.min(dc, this.nd[o]);
        // keep off the coasts; big ships avoid rivers and narrows
        let mul = 1 + 1.2 / Math.max(1, md);
        if (minClear > 0 && md < minClear && !(nearEnd(c) && nearEnd(o))) continue;
        if (big && md < 2) mul *= 3;
        const ng = G[c] + len * mul;
        if (seen[o] !== stamp || ng < G[o]) {
          seen[o] = stamp;
          G[o] = ng;
          from[o] = c;
          push(o, ng + hfn(o));
        }
      }
    }
    if (!found) return null;
    const out = [];
    for (let c = g; c !== -1; c = from[c]) out.push(c);
    out.reverse();
    return out;
  }

  // A cached route: its cells and the box of cells it passes through (a
  // patch inside the box drops it; a route across the seam spans the map)
  _routeEntry(cells) {
    const cw = this.cw;
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -1,
      y1 = -1;
    for (const c of cells) {
      const x = c % cw,
        y = (c / cw) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    return { cells, bx0: x0, by0: y0, bx1: x1, by1: y1 };
  }

  // A long voyage whose search ran out of cells: the route on a grid of 4 x 4
  // cell blocks (two blocks meet where a link of the water graph runs
  // between them), then the full search again inside that route's blocks
  // and their neighbours. Falls back to the whole search (as before round
  // 37) if the corridor holds no way.
  _coarseRoute(s, g, big, mc) {
    const cw = this.cw,
      ch = this.ch;
    const B = 4;
    const bw = Math.ceil(cw / B),
      bh = Math.ceil(ch / B);
    const wrapB = this.wrap;
    if (wrapB && cw % B !== 0) return this._astar(s, g, big, mc);
    const nb = bw * bh;
    if (!this._cb || this._cb.n !== nb) this._cb = { n: nb, G: new Float32Array(nb), from: new Int32Array(nb), seen: new Uint32Array(nb), done: new Uint32Array(nb), mark: new Uint32Array(nb), stamp: 0, hi: new Int32Array(256), hf: new Float32Array(256) };
    const S = this._cb;
    const stamp = ++S.stamp;
    const blk = (c) => (((c / cw) | 0) >> 2) * bw + ((c % cw) >> 2);
    const sb = blk(s),
      gb = blk(g);
    const gbx = gb % bw,
      gby = (gb / bw) | 0,
      sbx = sb % bw,
      sby = (sb / bw) | 0;
    const bdx = (a, b) => {
      const d = Math.abs(a - b);
      return wrapB ? Math.min(d, bw - d) : d;
    };
    const nearEnd = (b) => {
      const x = b % bw,
        y = (b / bw) | 0;
      return (bdx(x, sbx) <= 1 && Math.abs(y - sby) <= 1) || (bdx(x, gbx) <= 1 && Math.abs(y - gby) <= 1);
    };
    const hfn = (b) => {
      const dx = bdx(b % bw, gbx),
        dy = Math.abs(((b / bw) | 0) - gby);
      return dx + dy + (SQ2 - 2) * Math.min(dx, dy);
    };
    let hn = 0;
    const push = (i, f) => {
      if (hn >= S.hi.length) {
        const ni = new Int32Array(S.hi.length * 2);
        ni.set(S.hi);
        S.hi = ni;
        const nf = new Float32Array(S.hf.length * 2);
        nf.set(S.hf);
        S.hf = nf;
      }
      const HI = S.hi,
        HF = S.hf;
      let c = hn++;
      while (c > 0) {
        const p = (c - 1) >> 1;
        if (HF[p] <= f) break;
        HI[c] = HI[p];
        HF[c] = HF[p];
        c = p;
      }
      HI[c] = i;
      HF[c] = f;
    };
    const pop = () => {
      const HI = S.hi,
        HF = S.hf;
      const top = HI[0];
      const li = HI[--hn],
        lf = HF[hn];
      let c = 0;
      for (;;) {
        const l = c * 2 + 1;
        if (l >= hn) break;
        let m = l;
        if (l + 1 < hn && HF[l + 1] < HF[l]) m = l + 1;
        if (HF[m] >= lf) break;
        HI[c] = HI[m];
        HF[c] = HF[m];
        c = m;
      }
      HI[c] = li;
      HF[c] = lf;
      return top;
    };
    const { G, from, seen, done } = S;
    seen[sb] = stamp;
    G[sb] = 0;
    from[sb] = -1;
    push(sb, hfn(sb));
    let found = false;
    const nbs = [];
    while (hn) {
      const b = pop();
      if (done[b] === stamp) continue;
      done[b] = stamp;
      if (b === gb) {
        found = true;
        break;
      }
      // the blocks this one links to: every link out of its cells
      const bx = b % bw,
        by = (b / bw) | 0;
      const ne = nearEnd(b);
      nbs.length = 0;
      for (let y = by * B; y < Math.min(ch, by * B + B); y++)
        for (let x = bx * B; x < Math.min(cw, bx * B + B); x++) {
          const c = y * cw + x;
          const e = this.edges[c];
          if (!e) continue;
          for (let k = 0; k < 8; k++) {
            if (!(e & (1 << k))) continue;
            const o = this._lk(c, k);
            const ob = blk(o);
            if (ob === b || done[ob] === stamp || nbs.includes(ob)) continue;
            if (mc > 0 && Math.min(this.nd[c], this.nd[o]) < mc && !(ne && nearEnd(ob))) continue;
            nbs.push(ob);
          }
        }
      for (const ob of nbs) {
        const dx = bdx(ob % bw, bx),
          dy = Math.abs(((ob / bw) | 0) - by);
        const ng = G[b] + (dx && dy ? SQ2 : 1);
        if (seen[ob] !== stamp || ng < G[ob]) {
          seen[ob] = stamp;
          G[ob] = ng;
          from[ob] = b;
          push(ob, ng + hfn(ob));
        }
      }
    }
    if (!found) return null;
    // the corridor: the route's blocks and their neighbours
    const mark = S.mark;
    for (let b = gb; b !== -1; b = from[b]) {
      const bx = b % bw,
        by = (b / bw) | 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          let x = bx + dx;
          const y = by + dy;
          if (y < 0 || y >= bh) continue;
          if (x < 0 || x >= bw) {
            if (!wrapB) continue;
            x = (x + bw) % bw;
          }
          mark[y * bw + x] = stamp;
        }
    }
    return this._astar(s, g, big, mc, 0, { mark, stamp, bw }) || this._astar(s, g, big, mc);
  }

  // Nearest water point beside the shore near a land point (a landing), on
  // water that joins the graph. Returns {x, z, landX, landZ} or null.
  landingNear(x, z, R = 10, comp = -1) {
    const W = this.W,
      H = this.H;
    const h = this.world.height;
    const cx = Math.floor(x),
      cz = Math.floor(z);
    const cand = [];
    for (let dz = -R; dz <= R; dz++)
      for (let dx = -R; dx <= R; dx++) {
        const tx = cx + dx,
          tz = cz + dz;
        if (tx < 1 || tz < 1 || tx >= W - 1 || tz >= H - 1) continue;
        const i = tz * W + tx;
        if (h[i] >= SEA_LEVEL || this.dist[i] > 1.5 || this.dist[i] <= 0) continue;
        cand.push(dx * dx + dz * dz, tx, tz);
      }
    // nearest first; the (costly) water-body test runs on as few as possible
    const order = [];
    for (let k = 0; k < cand.length; k += 3) order.push(k);
    order.sort((a, b) => cand[a] - cand[b]);
    for (const k of order) {
      const tx = cand[k + 1],
        tz = cand[k + 2];
      {
        // a land neighbour to step onto
        let lx = -1,
          lz = -1;
        for (let k = 0; k < 8; k += 2) {
          const ax = tx + DIRS[k][0],
            az = tz + DIRS[k][1];
          if (h[az * W + ax] >= SEA_LEVEL) {
            lx = ax;
            lz = az;
            break;
          }
        }
        if (lx < 0) continue;
        if (comp >= 0 && this.comp(tx + 0.5, tz + 0.5) !== comp) continue;
        return { x: tx + 0.5, z: tz + 0.5, landX: lx + 0.5, landZ: lz + 0.5 };
      }
    }
    return null;
  }

  // Nearest water tile with some clearance near a point (a berth).
  waterNear(x, z, R = 6, minClear = 1) {
    const W = this.W,
      H = this.H;
    const cx = Math.floor(x),
      cz = Math.floor(z);
    let best = null,
      bd = Infinity;
    for (let dz = -R; dz <= R; dz++)
      for (let dx = -R; dx <= R; dx++) {
        const tx = cx + dx,
          tz = cz + dz;
        if (tx < 0 || tz < 0 || tx >= W || tz >= H) continue;
        const i = tz * W + tx;
        if (this.world.height[i] >= SEA_LEVEL || this.dist[i] < minClear || this.dist[i] <= 0) continue;
        const d = Math.hypot(tx + 0.5 - x, tz + 0.5 - z);
        if (d < bd) {
          bd = d;
          best = { x: tx + 0.5, z: tz + 0.5 };
        }
      }
    return best;
  }
}

export function pathLength(p) {
  let L = 0;
  for (let i = 2; i < p.length; i += 2) L += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
  return L;
}
