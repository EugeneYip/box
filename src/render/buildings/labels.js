import * as THREE from 'three';

// Floating map labels: kingdom names over capitals (mid and far zoom), village
// names (mid zoom), and crossed-swords markers over active battles. Canvas
// sprites in the Cinzel display face, sized by camera distance so they stay
// readable at every zoom, and faded out close to the ground.

const FONT = 'Cinzel, "Cinzel Variable", Georgia, "Times New Roman", serif';

function hexCss(hex, k = 1) {
  const r = Math.min(255, ((hex >> 16) & 255) * k),
    g = Math.min(255, ((hex >> 8) & 255) * k),
    b = Math.min(255, (hex & 255) * k);
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

function smooth(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function makeLabel(text, color, kind) {
  const big = kind === 'kingdom';
  const px = big ? 46 : 30;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = `${big ? 800 : 600} ${px}px ${FONT}`;
  const tw = Math.ceil(ctx.measureText(text).width);
  const padX = big ? 34 : 18,
    padY = big ? 16 : 10;
  c.width = tw + padX * 2 + (big ? 30 : 0);
  c.height = px + padY * 2 + (big ? 10 : 0);
  const x = c.getContext('2d');
  x.font = `${big ? 800 : 600} ${px}px ${FONT}`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  const cx = c.width / 2,
    cy = c.height / 2 - (big ? 3 : 0);
  if (big) {
    // a heraldic ribbon behind the name
    const h = px * 0.95;
    x.fillStyle = 'rgba(14,16,24,0.62)';
    x.beginPath();
    x.moveTo(8, cy - h / 2);
    x.lineTo(c.width - 8, cy - h / 2);
    x.lineTo(c.width - 22, cy);
    x.lineTo(c.width - 8, cy + h / 2);
    x.lineTo(8, cy + h / 2);
    x.lineTo(22, cy);
    x.closePath();
    x.fill();
    x.fillStyle = hexCss(color);
    x.fillRect(26, cy + h / 2 - 5, c.width - 52, 5);
    x.fillRect(26, cy - h / 2, c.width - 52, 3);
  }
  x.lineJoin = 'round';
  x.lineWidth = big ? 7 : 6;
  x.strokeStyle = 'rgba(10,12,18,0.85)';
  x.strokeText(text, cx, cy + 1);
  x.fillStyle = big ? '#fbf3df' : '#f4ecd8';
  x.fillText(text, cx, cy + 1);
  if (!big) {
    x.fillStyle = hexCss(color);
    x.beginPath();
    x.arc(10, cy + 1, 5, 0, Math.PI * 2);
    x.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, opacity: 0 });
  const sp = new THREE.Sprite(mat);
  sp.renderOrder = 20;
  sp.userData.aspect = c.width / c.height;
  sp.userData.text = text;
  sp.userData.color = color;
  return sp;
}

function swordsTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const x = c.getContext('2d');
  x.translate(48, 48);
  x.fillStyle = 'rgba(14,12,16,0.7)';
  x.beginPath();
  x.arc(0, 0, 44, 0, Math.PI * 2);
  x.fill();
  x.strokeStyle = 'rgba(255,90,60,0.95)';
  x.lineWidth = 4;
  x.beginPath();
  x.arc(0, 0, 42, 0, Math.PI * 2);
  x.stroke();
  for (const s of [-1, 1]) {
    x.save();
    x.rotate(s * Math.PI * 0.25);
    x.fillStyle = '#e9ecf2';
    x.strokeStyle = '#1a1a22';
    x.lineWidth = 3;
    x.beginPath();
    x.moveTo(-4, -34);
    x.lineTo(0, -40);
    x.lineTo(4, -34);
    x.lineTo(4, 16);
    x.lineTo(-4, 16);
    x.closePath();
    x.fill();
    x.stroke();
    x.fillStyle = '#d8a63a';
    x.fillRect(-13, 16, 26, 6);
    x.fillRect(-3, 22, 6, 12);
    x.beginPath();
    x.arc(0, 36, 4, 0, Math.PI * 2);
    x.fill();
    x.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Labels {
  constructor(game, parent) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.name = 'civ-labels';
    parent.add(this.group);
    this.kLabels = new Map(); // kingdom id -> sprite
    this.vLabels = new Map(); // village id -> sprite
    this.swords = [];
    this.swordTex = swordsTexture();
    this._t = 0;
    this._fontReady = false;
    try {
      document.fonts?.load?.(`800 46px Cinzel`).then(() => {
        this._fontReady = true;
        this.clear();
      });
    } catch {
      /* fonts API unavailable */
    }
  }

  clear() {
    for (const s of [...this.kLabels.values(), ...this.vLabels.values()]) {
      this.group.remove(s);
      s.material.map.dispose();
      s.material.dispose();
    }
    this.kLabels.clear();
    this.vLabels.clear();
  }

  _sync() {
    const civ = this.game.civ;
    const seenK = new Set(),
      seenV = new Set();
    for (const k of civ.kingdoms) {
      if (!k.alive || !k.villages.length) continue;
      seenK.add(k.id);
      let s = this.kLabels.get(k.id);
      if (s && (s.userData.text !== k.name || s.userData.color !== k.color)) {
        this.group.remove(s);
        s.material.map.dispose();
        s = null;
      }
      if (!s) {
        s = makeLabel(k.name, k.color, 'kingdom');
        this.kLabels.set(k.id, s);
        this.group.add(s);
      }
    }
    for (const v of civ.villages) {
      if (!v.alive) continue;
      seenV.add(v.id);
      const col = civ.kingdomColor(v.kingdom);
      let s = this.vLabels.get(v.id);
      if (s && (s.userData.text !== v.name || s.userData.color !== col)) {
        this.group.remove(s);
        s.material.map.dispose();
        s = null;
      }
      if (!s) {
        s = makeLabel(v.name, col, 'village');
        this.vLabels.set(v.id, s);
        this.group.add(s);
      }
    }
    for (const [id, s] of this.kLabels)
      if (!seenK.has(id)) {
        this.group.remove(s);
        this.kLabels.delete(id);
      }
    for (const [id, s] of this.vLabels)
      if (!seenV.has(id)) {
        this.group.remove(s);
        this.vLabels.delete(id);
      }
  }

  update(dt) {
    const g = this.game;
    const civ = g.civ;
    const rig = g.cameraRig;
    if (!civ || !rig) return;
    this._t += dt;
    this._syncT = (this._syncT || 0) - dt;
    if (this._syncT <= 0) {
      this._syncT = 0.75;
      this._sync();
    }
    const D = rig.cur.dist;
    const cam = rig.camera.position;
    const w = g.world;
    const kA = smooth(34, 70, D);
    // far zoom keeps only kingdom names
    const z01 = this.game.view?.zoom01 ?? 0;
    const vA = smooth(18, 30, D) * (1 - smooth(120, 190, D)) * (1 - smooth(0.4, 0.55, z01)) * (this.game.view?.far ? 0 : 1);
    const cand = [];
    for (const [id, s] of this.kLabels) {
      const k = civ.kingdoms[id];
      const v = civ.villages[k?.capital];
      if (!v || !v.alive || kA < 0.01) {
        s.visible = false;
        s.userData.fade = 0;
        continue;
      }
      const y = w.surfaceAt(v.cx, v.cz) + 2.5 + D * 0.03;
      s.position.set(v.cx, y, v.cz);
      const dist = cam.distanceTo(s.position);
      const h = Math.max(1.4, dist * 0.032);
      s.scale.set(h * s.userData.aspect, h, 1);
      cand.push({ s, a: kA, prio: 3 + (k.villages.length || 0) * 0.01 });
    }
    for (const [id, s] of this.vLabels) {
      const v = civ.villages[id];
      const k = civ.kingdoms[v?.kingdom];
      const isCap = k && k.capital === id;
      const a = isCap ? vA * (1 - kA) : vA;
      if (!v || a < 0.01) {
        s.visible = false;
        s.userData.fade = 0;
        continue;
      }
      const y = w.surfaceAt(v.cx, v.cz) + 1.6 + D * 0.02;
      s.position.set(v.cx, y, v.cz);
      const dist = cam.distanceTo(s.position);
      const h = Math.max(0.6, dist * 0.02);
      s.scale.set(h * s.userData.aspect, h, 1);
      cand.push({ s, a, prio: (isCap ? 2 : 1) + (v.pop || 0) * 0.001 });
    }
    // battle markers
    const battles = civ.battles || [];
    while (this.swords.length < battles.length) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.swordTex, transparent: true, depthTest: false, depthWrite: false }));
      sp.renderOrder = 21;
      this.group.add(sp);
      this.swords.push(sp);
    }
    const sA = smooth(14, 26, D);
    for (let i = 0; i < this.swords.length; i++) {
      const sp = this.swords[i];
      const b = battles[i];
      if (!b || sA < 0.01) {
        sp.visible = false;
        sp.userData.fade = 0;
        continue;
      }
      sp.position.set(b.x, w.surfaceAt(b.x, b.z) + 2 + D * 0.025, b.z);
      const dist = cam.distanceTo(sp.position);
      const h = Math.max(1.1, dist * 0.04) * (1 + Math.sin(this._t * 5 + i) * 0.06);
      sp.scale.set(h, h, 1);
      cand.push({ s: sp, a: sA, prio: 2.5 });
    }
    this._declutter(cand, dt);
  }

  // Hide labels that collide with a higher-priority label or with the HUD.
  _declutter(cand, dt) {
    const rig = this.game.cameraRig;
    const cam = rig.camera;
    const W = innerWidth,
      H = innerHeight;
    this._hudT = (this._hudT || 0) - dt;
    if (this._hudT <= 0) {
      this._hudT = 1;
      this._hud = [];
      try {
        for (const el of document.querySelectorAll('#ui-root .hud-panel, #ui-root [class*="panel"], #ui-root [class*="toolbar"], #ui-root [class*="feed"], #ui-root [class*="minimap"]')) {
          const r = el.getBoundingClientRect();
          if (r.width > 4 && r.height > 4 && getComputedStyle(el).visibility !== 'hidden' && r.width < W * 0.95) this._hud.push(r);
        }
      } catch {
        /* no DOM */
      }
    }
    const uiOn = this.game.params?.ui !== false;
    const fovK = H / (2 * Math.tan((cam.fov * Math.PI) / 360));
    const v = this._v || (this._v = new (cam.position.constructor)());
    cand.sort((a, b) => b.prio - a.prio);
    const taken = [];
    for (const c of cand) {
      const sp = c.s;
      v.copy(sp.position).project(cam);
      let target = c.a;
      if (v.z > 1 || v.z < -1) target = 0;
      const sx = (v.x * 0.5 + 0.5) * W,
        sy = (-v.y * 0.5 + 0.5) * H;
      const dist = cam.position.distanceTo(sp.position);
      let ph = (sp.scale.y / Math.max(0.01, dist)) * fovK;
      let pw = (sp.scale.x / Math.max(0.01, dist)) * fovK;
      // cap on-screen size: an anchor close to the camera (e.g. a realm centre
      // just below the view) would otherwise blow its label up across the frame
      const maxPx = c.prio >= 3 ? 44 : 52;
      if (ph > maxPx) {
        const k = maxPx / ph;
        sp.scale.x *= k;
        sp.scale.y *= k;
        ph = maxPx;
        pw *= k;
      }
      const rect = { l: sx - pw / 2, r: sx + pw / 2, t: sy - ph / 2, b: sy + ph / 2 };
      const hits = (r) => {
        for (const o of taken) if (r.l < o.r && r.r > o.l && r.t < o.b && r.b > o.t) return true;
        if (uiOn) for (const h of this._hud) if (r.l < h.right && r.r > h.left && r.t < h.bottom && r.b > h.top) return true;
        return false;
      };
      if (target > 0 && c.prio >= 3 && v.z <= 1 && v.z >= -1) {
        // a realm's name is never dropped: clamp it into the safe area and
        // nudge it up or down until it no longer collides
        const top = uiOn ? 90 : 8,
          bot = H - (uiOn ? 90 : 8),
          right = W - (uiOn ? 300 : 8);
        let cx = Math.min(right - pw / 2, Math.max(8 + pw / 2, sx)),
          cy = Math.min(bot - ph / 2, Math.max(top + ph / 2, sy));
        let placed = false;
        for (const dy of [0, -1.1, 1.1, -2.2, 2.2, -3.3, 3.3]) {
          const yy = cy + dy * ph;
          if (yy - ph / 2 < top || yy + ph / 2 > bot) continue;
          const r = { l: cx - pw / 2, r: cx + pw / 2, t: yy - ph / 2, b: yy + ph / 2 };
          if (!hits(r)) {
            rect.l = r.l;
            rect.r = r.r;
            rect.t = r.t;
            rect.b = r.b;
            cy = yy;
            placed = true;
            break;
          }
        }
        if (placed && (cx !== sx || Math.abs(cy - sy) > 0.5)) {
          // move the sprite to the adjusted screen point at the same depth
          v.set((cx / W) * 2 - 1, -((cy / H) * 2 - 1), v.z).unproject(cam);
          sp.position.copy(v);
          // the label was sized for its anchor's distance; at the pinned point
          // (same depth, much less lateral offset) it must shrink to match
          const k = cam.position.distanceTo(v) / Math.max(0.01, dist);
          sp.scale.x *= k;
          sp.scale.y *= k;
        }
        if (!placed) target = 0;
      } else if (target > 0) {
        // keep clear of the screen edges where the HUD lives
        if (uiOn && (rect.t < 90 || rect.b > H - 90 || rect.r > W - 300 || rect.l < 8)) target = 0;
        if (hits(rect)) target = 0;
      }
      if (target > 0.02) taken.push(rect);
      const f = sp.userData.fade ?? target;
      const nf = f + (target - f) * Math.min(1, dt * 6);
      sp.userData.fade = nf;
      sp.material.opacity = nf;
      sp.visible = nf > 0.01;
    }
  }
}
