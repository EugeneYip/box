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
    const vA = smooth(18, 30, D) * (1 - smooth(120, 190, D));
    for (const [id, s] of this.kLabels) {
      const k = civ.kingdoms[id];
      const v = civ.villages[k?.capital];
      if (!v || !v.alive || kA < 0.01) {
        s.visible = false;
        continue;
      }
      const y = w.surfaceAt(v.cx, v.cz) + 2.5 + D * 0.03;
      s.position.set(v.cx, y, v.cz);
      const dist = cam.distanceTo(s.position);
      const h = Math.max(1.4, dist * 0.032);
      s.scale.set(h * s.userData.aspect, h, 1);
      s.material.opacity = kA;
      s.visible = true;
    }
    for (const [id, s] of this.vLabels) {
      const v = civ.villages[id];
      const k = civ.kingdoms[v?.kingdom];
      const isCap = k && k.capital === id;
      const a = isCap ? vA * (1 - kA) : vA;
      if (!v || a < 0.01) {
        s.visible = false;
        continue;
      }
      const y = w.surfaceAt(v.cx, v.cz) + 1.6 + D * 0.02;
      s.position.set(v.cx, y, v.cz);
      const dist = cam.distanceTo(s.position);
      const h = Math.max(0.6, dist * 0.02);
      s.scale.set(h * s.userData.aspect, h, 1);
      s.material.opacity = a;
      s.visible = true;
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
        continue;
      }
      sp.position.set(b.x, w.surfaceAt(b.x, b.z) + 2 + D * 0.025, b.z);
      const dist = cam.distanceTo(sp.position);
      const h = Math.max(1.1, dist * 0.04) * (1 + Math.sin(this._t * 5 + i) * 0.06);
      sp.scale.set(h, h, 1);
      sp.material.opacity = sA;
      sp.visible = true;
    }
  }
}
