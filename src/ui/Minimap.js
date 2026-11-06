import * as THREE from 'three';
import { TILE_INFO, FLORA_INFO, SEA_LEVEL, MAX_HEIGHT } from '../world/constants.js';
import { uiIcon } from './icons.js';
import { el, safe, rgbOf } from './dom.js';

// Painted minimap: terrain colour with hillshade, water depth, forest
// darkening and kingdom territory tint with crisp borders. Redrawn
// incrementally from 'world:*' dirty rects; the camera footprint, villages and
// the selection live on a separate overlay canvas redrawn every frame.
export class Minimap {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    const W = this.game.world;
    this.w = W.w;
    this.h = W.h;
    this.base = el('canvas', { class: 'ws-map__base', width: this.w, height: this.h });
    this.over = el('canvas', { class: 'ws-map__over' });
    this.bctx = this.base.getContext('2d');
    this.octx = this.over.getContext('2d');
    this.img = this.bctx.createImageData(this.w, this.h);
    this.collapseBtn = el('button', {
      class: 'ws-iconbtn ws-iconbtn--sm ws-map__btn',
      type: 'button',
      'aria-label': 'Collapse map',
      'data-tip': 'Hide map',
      html: uiIcon('chev-down'),
      onclick: (e) => {
        e.stopPropagation();
        this.setCollapsed(true);
      },
    });
    this.openBtn = el('button', {
      class: 'ws-map__open ws-glass',
      type: 'button',
      'aria-label': 'Show map',
      'data-tip': 'Show map',
      html: uiIcon('map'),
      onclick: () => this.setCollapsed(false),
    });
    this.frame = el(
      'div',
      { class: 'ws-map__frame' },
      this.base,
      this.over,
      el('span', { class: 'ws-map__north', text: 'N' }),
      el('span', { class: 'ws-map__vignette' }),
    );
    this.el = el('div', { class: 'ws-map ws-glass ws-orn' }, this.frame, this.collapseBtn);
    this.wrap = el('div', { class: 'ws-mapwrap' }, this.el, this.openBtn);

    this.dirty = { x0: 0, y0: 0, x1: this.w - 1, y1: this.h - 1 };
    this._t = 0;
    this._kcol = new Map();
    const mark = (r) => this.mark(r);
    const ev = this.game.events;
    for (const k of ['world:height', 'world:type', 'world:owner', 'world:flora', 'world:fire']) ev.on(k, mark);
    ev.on('world:regenerated', () => this.markAll());

    // click / drag to move the camera
    this.over.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.over.setPointerCapture?.(e.pointerId);
      this._drag = true;
      this.jump(e, true);
      this.game.audio?.play?.('ui-click', { volume: 0.35 });
    });
    this.over.addEventListener('pointermove', (e) => this._drag && this.jump(e, false));
    const end = () => (this._drag = false);
    this.over.addEventListener('pointerup', end);
    this.over.addEventListener('pointercancel', end);
    this.over.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.game.cameraRig.zoom(Math.exp((e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY) * 0.0012));
    }, { passive: false });

    this._ray = new THREE.Raycaster();
    this._v = new THREE.Vector2();
    this.redraw(true);
  }

  setCollapsed(c, quiet = false) {
    this.collapsed = c;
    this.wrap.classList.toggle('is-collapsed', c);
    if (!quiet) this.game.audio?.play?.('ui-click', { volume: 0.4 });
    this.ui.savePrefs?.({ mapCollapsed: c });
  }
  setVisible(v) {
    this.wrap.classList.toggle('is-off', !v);
  }

  mark(r) {
    const d = this.dirty;
    if (!d) this.dirty = { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 };
    else {
      if (r.x0 < d.x0) d.x0 = r.x0;
      if (r.y0 < d.y0) d.y0 = r.y0;
      if (r.x1 > d.x1) d.x1 = r.x1;
      if (r.y1 > d.y1) d.y1 = r.y1;
    }
  }
  markAll() {
    this._kcol.clear();
    this.dirty = { x0: 0, y0: 0, x1: this.w - 1, y1: this.h - 1 };
    this._t = 0;
  }

  kingdomRGB(id) {
    let c = this._kcol.get(id);
    if (!c) {
      c = rgbOf(safe(() => this.game.civ.kingdomColor(id), 0xe9c77b) ?? 0xe9c77b);
      this._kcol.set(id, c);
    }
    return c;
  }

  redraw(force = false) {
    const r = this.dirty;
    if (!r) return;
    this.dirty = null;
    const W = this.game.world;
    const { height, type, flora, owner, fire, floraGrowth } = W;
    const w = this.w,
      h = this.h;
    const data = this.img.data;
    // expand by one tile so hillshade / borders at the rect edge stay correct
    const x0 = Math.max(0, r.x0 - 1),
      y0 = Math.max(0, r.y0 - 1),
      x1 = Math.min(w - 1, r.x1 + 1),
      y1 = Math.min(h - 1, r.y1 + 1);
    const shallow = [96, 196, 214],
      mid = [36, 120, 176],
      deep = [12, 44, 96];
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const i = ty * w + tx;
        const hh = height[i];
        const hl = height[ty * w + Math.max(0, tx - 1)],
          hr = height[ty * w + Math.min(w - 1, tx + 1)];
        const hu = height[Math.max(0, ty - 1) * w + tx],
          hd = height[Math.min(h - 1, ty + 1) * w + tx];
        let R, G, B;
        if (hh < SEA_LEVEL) {
          const d = Math.min(1, -hh / 7.5);
          const t1 = Math.min(1, d * 2.2),
            t2 = Math.max(0, (d - 0.45) / 0.55);
          R = shallow[0] + (mid[0] - shallow[0]) * t1 + (deep[0] - mid[0]) * t2;
          G = shallow[1] + (mid[1] - shallow[1]) * t1 + (deep[1] - mid[1]) * t2;
          B = shallow[2] + (mid[2] - shallow[2]) * t1 + (deep[2] - mid[2]) * t2;
          // faint seabed relief + bright surf line next to land
          const sh = 1 + ((hl - hr) * 0.6 + (hu - hd) * 0.6) * 0.05;
          R *= sh;
          G *= sh;
          B *= sh;
          if (hh > -0.45 && (hl >= 0 || hr >= 0 || hu >= 0 || hd >= 0)) {
            R += (236 - R) * 0.45;
            G += (246 - G) * 0.45;
            B += (240 - B) * 0.45;
          }
        } else {
          const info = TILE_INFO[type[i]] || TILE_INFO[1];
          const c = info.color;
          R = (c >> 16) & 255;
          G = (c >> 8) & 255;
          B = c & 255;
          const f = flora[i];
          if (f && FLORA_INFO[f]?.isTree) {
            const k = 0.62 + 0.18 * (1 - (floraGrowth[i] || 1));
            R = R * k * 0.86;
            G = G * k * 0.98;
            B = B * k * 0.84;
          }
          // hillshade, light from the north-west
          const dx = hr - hl,
            dz = hd - hu;
          let sh = 1 - (dx + dz) * 0.16;
          sh = sh < 0.55 ? 0.55 : sh > 1.45 ? 1.45 : sh;
          const alt = 0.92 + (hh / MAX_HEIGHT) * 0.22;
          R *= sh * alt;
          G *= sh * alt;
          B *= sh * alt;
        }
        const o = owner[i];
        if (o >= 0) {
          const kc = this.kingdomRGB(o);
          const border =
            (tx > 0 && owner[i - 1] !== o) || (tx < w - 1 && owner[i + 1] !== o) || (ty > 0 && owner[i - w] !== o) || (ty < h - 1 && owner[i + w] !== o);
          const a = border ? 0.85 : hh < SEA_LEVEL ? 0.18 : 0.34;
          R += (kc[0] - R) * a;
          G += (kc[1] - G) * a;
          B += (kc[2] - B) * a;
          if (border) {
            R += (255 - R) * 0.18;
            G += (255 - G) * 0.18;
            B += (255 - B) * 0.18;
          }
        }
        const fi = fire[i];
        if (fi > 0) {
          const a = Math.min(1, 0.55 + fi * 0.45);
          R += (255 - R) * a;
          G += (120 - G) * a;
          B += (30 - B) * a;
        }
        const p = i * 4;
        data[p] = R > 255 ? 255 : R;
        data[p + 1] = G > 255 ? 255 : G;
        data[p + 2] = B > 255 ? 255 : B;
        data[p + 3] = 255;
      }
    }
    this.bctx.putImageData(this.img, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
  }

  // Map a pointer event to world XZ and move the camera there.
  jump(e, first) {
    const rect = this.over.getBoundingClientRect();
    const u = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const v = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    const rig = this.game.cameraRig;
    rig.follow = null;
    rig.goal.x = u * this.w;
    rig.goal.z = v * this.h;
    rig.clampGoal?.();
  }

  // Ground footprint of the camera frustum (intersected with the sea plane).
  footprint() {
    const cam = this.game.cameraRig.camera;
    const pts = [];
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    for (const [x, y] of corners) {
      this._v.set(x, y);
      this._ray.setFromCamera(this._v, cam);
      const o = this._ray.ray.origin,
        d = this._ray.ray.direction.clone();
      if (d.y > -0.04) d.y = -0.04;
      d.normalize();
      let t = (o.y - SEA_LEVEL) / -d.y;
      t = Math.min(t, this.w * 3);
      pts.push([o.x + d.x * t, o.z + d.z * t]);
    }
    return pts;
  }

  drawOverlay() {
    const c = this.over;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const cw = Math.round(c.clientWidth * dpr),
      ch = Math.round(c.clientHeight * dpr);
    if (!cw || !ch) return;
    if (c.width !== cw || c.height !== ch) {
      c.width = cw;
      c.height = ch;
    }
    const ctx = this.octx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    const sx = cw / this.w,
      sy = ch / this.h;
    const g = this.game;
    const now = performance.now() / 1000;

    // villages
    const villages = safe(() => g.civ?.villages || [], []);
    for (const v of villages) {
      if (!v || v.alive === false || v.x == null) continue;
      const kc = v.kingdom != null && v.kingdom >= 0 ? this.kingdomRGB(v.kingdom) : [245, 238, 223];
      const x = v.x * sx,
        y = v.z * sy,
        r = 2.6 * dpr;
      ctx.beginPath();
      ctx.moveTo(x, y - r * 1.25);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r * 1.25);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      ctx.fillStyle = `rgb(${kc[0]},${kc[1]},${kc[2]})`;
      ctx.fill();
      ctx.lineWidth = 1 * dpr;
      ctx.strokeStyle = 'rgba(16,14,10,.85)';
      ctx.stroke();
    }

    // selection
    const sel = g.selected?.ref;
    if (sel && sel.x != null && sel.alive !== false) {
      const x = sel.x * sx,
        y = sel.z * sy;
      const pulse = (now * 1.4) % 1;
      ctx.beginPath();
      ctx.arc(x, y, (3 + pulse * 7) * dpr, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(251,227,166,${(1 - pulse) * 0.9})`;
      ctx.lineWidth = 1.4 * dpr;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, 2.2 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = '#fbe3a6';
      ctx.fill();
    }

    // camera footprint
    const pts = this.footprint();
    ctx.beginPath();
    pts.forEach(([x, z], i) => (i ? ctx.lineTo(x * sx, z * sy) : ctx.moveTo(x * sx, z * sy)));
    ctx.closePath();
    ctx.fillStyle = 'rgba(251,227,166,0.10)';
    ctx.fill();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.6 * dpr;
    ctx.strokeStyle = 'rgba(10,10,14,0.45)';
    ctx.stroke();
    ctx.lineWidth = 1.3 * dpr;
    ctx.strokeStyle = 'rgba(251,227,166,0.95)';
    ctx.stroke();
    // target pip
    const rig = g.cameraRig;
    ctx.beginPath();
    ctx.arc(rig.cur.x * sx, rig.cur.z * sy, 1.8 * dpr, 0, Math.PI * 2);
    ctx.fillStyle = '#fbe3a6';
    ctx.fill();
  }

  update(dt) {
    if (this.collapsed || this.wrap.classList.contains('is-off')) return;
    this._t -= dt;
    if (this.dirty && this._t <= 0) {
      this._t = 0.2;
      this.redraw();
    }
    this.drawOverlay();
  }
}
