import * as THREE from 'three';
import { drawBanner, bannerDataURL } from './emblems.js';
import { BUILDING } from '../../core/scale.js';

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

function makeLabel(text, color, kind, banner = null) {
  const big = kind === 'kingdom';
  const px = big ? 46 : 30;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = `${big ? 800 : 600} ${px}px ${FONT}`;
  const tw = Math.ceil(ctx.measureText(text).width);
  const padX = big ? 34 : 18,
    padY = big ? 16 : 10;
  const bw = big && banner ? 40 : 0; // the realm's banner before its name
  c.width = tw + padX * 2 + (big ? 30 : 0) + bw;
  c.height = px + padY * 2 + (big ? 10 : 0);
  const x = c.getContext('2d');
  x.font = `${big ? 800 : 600} ${px}px ${FONT}`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  const cx = c.width / 2 + bw / 2,
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
    if (bw) drawBanner(x, banner, color, 26, cy - h * 0.62, 34, h * 1.24);
  }
  if (!big) {
    // (round 27) a dark rounded plate behind a town's name, so it reads over
    // light roofs and paved plazas
    const pw = c.width - 4,
      ph = px + 8,
      r = ph / 2;
    x.fillStyle = 'rgba(14,16,24,0.5)';
    x.beginPath();
    x.moveTo(2 + r, cy + 1 - ph / 2);
    x.lineTo(2 + pw - r, cy + 1 - ph / 2);
    x.arc(2 + pw - r, cy + 1, r, -Math.PI / 2, Math.PI / 2);
    x.lineTo(2 + r, cy + 1 + ph / 2);
    x.arc(2 + r, cy + 1, r, Math.PI / 2, (Math.PI * 3) / 2);
    x.closePath();
    x.fill();
  }
  x.lineJoin = 'round';
  x.lineWidth = big ? 7 : 7;
  x.strokeStyle = big ? 'rgba(10,12,18,0.85)' : 'rgba(8,10,16,0.95)';
  x.strokeText(text, cx, cy + 1);
  x.fillStyle = big ? '#fbf3df' : '#f4ecd8';
  x.fillText(text, cx, cy + 1);
  if (!big) {
    x.fillStyle = hexCss(color);
    x.beginPath();
    x.arc(12, cy + 1, 5, 0, Math.PI * 2);
    x.fill();
  }
  const sp = labelNode(c);
  sp.userData.aspect = c.width / c.height;
  sp.userData.text = text;
  sp.userData.color = color;
  sp.userData.banner = banner ? banner.symbol + '|' + banner.field : '';
  return sp;
}

// A label is a positioner (an Object3D, never drawn itself) whose image sits
// in the shared atlas; LabelBatch draws every visible label in ONE instanced
// draw (each canvas sprite was its own draw call: ~19 at mid zoom).
function labelNode(canvas) {
  const sp = new THREE.Object3D();
  sp.material = { opacity: 0, map: { dispose() {} }, dispose() {} };
  sp.userData.canvas = canvas;
  sp.userData.rect = null;
  sp.visible = false;
  return sp;
}

const ATLAS = 2048;
const PAD = 4;
class LabelBatch {
  constructor(parent) {
    const c = document.createElement('canvas');
    c.width = c.height = ATLAS;
    this.canvas = c;
    this.ctx = c.getContext('2d');
    this.tex = new THREE.CanvasTexture(c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.x = this.y = this.row = 0;
    this.parent = parent;
    this.mesh = this._make(64);
    parent.add(this.mesh);
  }
  _make(cap) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.setAttribute('aUv', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4));
    geo.setAttribute('aSO', new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: this.tex } },
      vertexShader: `
attribute vec4 aUv;
attribute vec3 aSO;
varying vec2 vUv;
varying float vA;
void main() {
  vUv = aUv.xy + uv * aUv.zw;
  vA = aSO.z;
  vec4 mv = modelViewMatrix * vec4(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2], 1.0);
  mv.xy += position.xy * aSO.xy;
  gl_Position = projectionMatrix * mv;
}`,
      fragmentShader: `
uniform sampler2D uMap;
varying vec2 vUv;
varying float vA;
void main() {
  vec4 t = texture2D(uMap, vUv);
  gl_FragColor = vec4(t.rgb, t.a * vA);
  if (gl_FragColor.a < 0.004) discard;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const m = new THREE.InstancedMesh(geo, mat, cap);
    m.name = 'civ-labels:batch';
    m.frustumCulled = false;
    m.renderOrder = 20;
    m.count = 0;
    return m;
  }
  reset() {
    this.ctx.clearRect(0, 0, ATLAS, ATLAS);
    this.x = this.y = this.row = 0;
    this.tex.needsUpdate = true;
  }
  // packs a label's canvas into the atlas: its uv rect, or null when full
  add(src) {
    const w = src.width + PAD * 2,
      h = src.height + PAD * 2;
    if (this.x + w > ATLAS) {
      this.x = 0;
      this.y += this.row;
      this.row = 0;
    }
    if (this.y + h > ATLAS || w > ATLAS) return null;
    const px = this.x + PAD,
      py = this.y + PAD;
    this.ctx.drawImage(src, px, py);
    this.x += w;
    this.row = Math.max(this.row, h);
    this.tex.needsUpdate = true;
    return [px / ATLAS, 1 - (py + src.height) / ATLAS, src.width / ATLAS, src.height / ATLAS];
  }
  // every visible label, in draw order; lists are arrays or Maps (walked twice,
  // so never pass one-shot iterators)
  draw(lists) {
    const each = (L) => (L instanceof Map ? L.values() : L);
    let n = 0;
    for (const L of lists) for (const sp of each(L)) if (sp.visible && sp.userData.rect && sp.material.opacity > 0.01) n++;
    if (this.mesh.instanceMatrix.count < n) {
      const nm = this._make(Math.ceil(n * 1.5));
      this.parent.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      this.mesh = nm;
      this.parent.add(nm);
    }
    const m = this.mesh;
    const uvA = m.geometry.getAttribute('aUv'),
      soA = m.geometry.getAttribute('aSO');
    const M = m.instanceMatrix.array;
    let i = 0;
    for (const L of lists)
      for (const sp of each(L)) {
        const r = sp.userData.rect;
        if (!sp.visible || !r || sp.material.opacity <= 0.01) continue;
        M.fill(0, i * 16, i * 16 + 16);
        M[i * 16] = M[i * 16 + 5] = M[i * 16 + 10] = M[i * 16 + 15] = 1;
        M[i * 16 + 12] = sp.position.x;
        M[i * 16 + 13] = sp.position.y;
        M[i * 16 + 14] = sp.position.z;
        uvA.array.set(r, i * 4);
        soA.array[i * 3] = sp.scale.x;
        soA.array[i * 3 + 1] = sp.scale.y;
        soA.array[i * 3 + 2] = sp.material.opacity;
        i++;
      }
    m.count = i;
    m.visible = i > 0;
    m.instanceMatrix.needsUpdate = true;
    uvA.needsUpdate = true;
    soA.needsUpdate = true;
  }
}

// Spots tried for a realm's name, in label widths (x) and heights (y) from
// its seat, nearest first.
const LABEL_SPOTS = [
  [0, 0], [0, -1.1], [0, 1.1], [-0.3, 0], [0.3, 0], [-0.3, -1.1], [0.3, -1.1], [-0.3, 1.1], [0.3, 1.1],
  [-0.48, 0], [0.48, 0], [-0.48, -1.1], [0.48, -1.1], [-0.48, 1.1], [0.48, 1.1], [0, -2.2], [0, 2.2],
];
// (round 27) the last, smaller try also looks a little farther round the seat
const LABEL_SPOTS_WIDE = [
  ...LABEL_SPOTS,
  [-0.75, 0], [0.75, 0], [-0.75, -1.1], [0.75, -1.1], [-0.75, 1.1], [0.75, 1.1],
  [-0.3, -2.2], [0.3, -2.2], [-0.3, 2.2], [0.3, 2.2], [0, -3.3], [0, 3.3], [-1, 0], [1, 0],
];

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
  return c;
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
    this.swordCanvas = swordsTexture();
    this.batch = new LabelBatch(this.group);
    this._t = 0;
    this._fontReady = false;
    // player edits (names, colours, banners) show at once
    game.events?.on?.('edit', () => (this._syncT = 0));
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
    for (const s of [...this.kLabels.values(), ...this.vLabels.values()]) this.group.remove(s);
    this.kLabels.clear();
    this.vLabels.clear();
    this.batch.reset();
    for (const sp of this.swords) sp.userData.rect = null;
  }

  // a label's place in the atlas; a full atlas is repacked from the labels
  // still in use
  _pack(sp) {
    let r = this.batch.add(sp.userData.canvas);
    if (!r) {
      this.batch.reset();
      for (const o of [...this.kLabels.values(), ...this.vLabels.values(), ...this.swords]) if (o !== sp) o.userData.rect = o.userData.canvas ? this.batch.add(o.userData.canvas) : null;
      r = this.batch.add(sp.userData.canvas);
    }
    sp.userData.rect = r;
  }

  _sync() {
    const civ = this.game.civ;
    // the inspector and editor draw banners through the civ
    if (civ && !civ.bannerImage)
      civ.bannerImage = (kid, size = 64) => {
        const k = civ.kingdoms[kid];
        return k ? bannerDataURL(k.banner, k.color, size) : '';
      };
    const seenK = new Set(),
      seenV = new Set();
    for (const k of civ.kingdoms) {
      if (!k.alive || !k.villages.length) continue;
      seenK.add(k.id);
      let s = this.kLabels.get(k.id);
      const bkey = k.banner ? k.banner.symbol + '|' + k.banner.field : '';
      if (s && (s.userData.text !== k.name || s.userData.color !== k.color || s.userData.banner !== bkey)) s = null;
      if (!s) {
        s = makeLabel(k.name, k.color, 'kingdom', k.banner);
        this.kLabels.set(k.id, s);
        this._pack(s);
      }
    }
    for (const v of civ.villages) {
      if (!v.alive) continue;
      seenV.add(v.id);
      const col = civ.kingdomColor(v.kingdom);
      let s = this.vLabels.get(v.id);
      if (s && (s.userData.text !== v.name || s.userData.color !== col)) s = null;
      if (!s) {
        s = makeLabel(v.name, col, 'village');
        this.vLabels.set(v.id, s);
        this._pack(s);
      }
    }
    for (const [id, s] of this.kLabels)
      if (!seenK.has(id)) this.kLabels.delete(id);
    for (const [id, s] of this.vLabels)
      if (!seenV.has(id)) this.vLabels.delete(id);
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
    // (round 27) realm names take over from town names in a narrow band
    // (50-56 tiles) instead of a half tone from 34 to 70, so between 40 and 80
    // every name on screen is drawn solid: the town names below the band, the
    // realm's name above it (its capital's name stays if the realm is not named)
    const kA = smooth(50, 56, D);
    // far zoom keeps only kingdom names
    const z01 = this.game.view?.zoom01 ?? 0;
    const vA = smooth(18, 30, D) * (1 - smooth(120, 190, D)) * (1 - smooth(0.4, 0.55, z01)) * (this.game.view?.far ? 0 : 1);
    const cand = [];
    // mid-zoom: only the realm in view and its neighbours are named (all of
    // them at the overview); close in, only the realm in view
    const mid = 1 - smooth(120, 170, D);
    if (mid > 0.01 && (this._focusT = (this._focusT || 0) - dt) <= 0) {
      this._focusT = 0.5;
      const tx = Math.floor(rig.cur.x),
        tz = Math.floor(rig.cur.z);
      let fk = w.inBounds?.(tx, tz) ? w.owner[tz * w.w + tx] : -1;
      if (!(fk >= 0)) {
        let bd = Infinity;
        for (const k of civ.kingdoms) {
          const cv = k.alive ? civ.villages[k.capital] : null;
          if (!cv?.alive) continue;
          const d = Math.hypot(cv.cx - rig.cur.x, cv.cz - rig.cur.z);
          if (d < bd) (bd = d), (fk = k.id);
        }
      }
      const show = (this._focusSet = this._focusSet || new Set());
      show.clear();
      if (fk >= 0) {
        show.add(fk);
        if (D > 80) for (const r of civ.relations?.values?.() || []) if ((r.border || 0) > 0 && (r.a === fk || r.b === fk)) show.add(r.a === fk ? r.b : r.a);
      }
    }
    for (const [id, s] of this.kLabels) {
      const k = civ.kingdoms[id];
      const v = k && k.alive && k.villages.length ? civ.villages[k.capital] : null; // no names for fallen realms
      const kAk = mid > 0.01 && this._focusSet?.size && !this._focusSet.has(id) ? kA * (1 - mid) : kA;
      if (!v || !v.alive || kAk < 0.01) {
        s.visible = false;
        s.userData.fade = 0;
        continue;
      }
      const ax = k.labelX ?? v.cx,
        az = k.labelZ ?? v.cz;
      const y = w.surfaceAt(ax, az) + 2.5 * BUILDING.scale + D * 0.03;
      s.position.set(ax, y, az);
      const dist = cam.distanceTo(s.position);
      const many = this.kLabels.size > 9 ? Math.max(0.45, 1 - (this.kLabels.size - 9) * 0.03) : 1;
      const h = Math.max(1.4, dist * 0.032 * many);
      s.scale.set(h * s.userData.aspect, h, 1);
      cand.push({ s, a: kAk, prio: 3 + (k.villages.length || 0) * 0.01 + (this._focusSet?.has(id) ? 0.5 : 0), kid: id });
    }
    for (const [id, s] of this.vLabels) {
      const v = civ.villages[id];
      const k = civ.kingdoms[v?.kingdom];
      const isCap = k && k.capital === id;
      // (round 27) a capital gives way only to its realm's name actually on
      // screen (not to the zoom alone: at 55 tiles a capital whose realm is
      // not named faded to a ghost outline); a short cross-fade, never a half
      // tone held over a range of zoom
      const kS = isCap ? this.kLabels.get(k.id) : null;
      const kOn = kS && kS.visible ? kS.userData.fade || 0 : 0;
      const a = isCap ? vA * (1 - smooth(0.3, 0.6, kOn)) : vA;
      if (!v || a < 0.01) {
        s.visible = false;
        s.userData.fade = 0;
        continue;
      }
      const y = w.surfaceAt(v.cx, v.cz) + 1.6 * BUILDING.scale + D * 0.02;
      s.position.set(v.cx, y, v.cz);
      const dist = cam.distanceTo(s.position);
      // (about 12 px capitals on screen: at 0.02 a town's name was ~8 px
      // capitals at 30 tiles, hard to read)
      const h = Math.max(0.8, dist * 0.029);
      s.scale.set(h * s.userData.aspect, h, 1);
      cand.push({ s, a, prio: (isCap ? 2 : 1) + (v.pop || 0) * 0.001 });
    }
    // battle markers
    const battles = civ.battles || [];
    while (this.swords.length < battles.length) {
      const sp = labelNode(this.swordCanvas);
      sp.userData.aspect = 1;
      this.swords.push(sp);
    }
    for (const sp of this.swords) if (!sp.userData.rect) this._pack(sp);
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
    this.batch.draw([this.vLabels, this.kLabels, this.swords]);
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
        for (const el of document.querySelectorAll('#ui-root .hud-panel, #ui-root [class*="panel"], #ui-root [class*="toolbar"], #ui-root [class*="feed"], #ui-root [class*="minimap"], #ui-root [class*="chip"], #ui-root [class*="badge"], #ui-root [class*="topbar"], #ui-root [class*="dock"], #ui-root [class*="glass"]')) {
          const r = el.getBoundingClientRect();
          if (r.width > 4 && r.height > 4 && getComputedStyle(el).visibility !== 'hidden' && r.width < W * 0.95) this._hud.push(r);
        }
      } catch {
        /* no DOM */
      }
    }
    const uiOn = this.game.params?.ui !== false;
    // HUD-safe margins that scale with the screen (phones and tablets in portrait)
    const mTop = uiOn ? Math.min(90, H * 0.1) : 8,
      mBot = uiOn ? Math.min(90, H * 0.12) : 8,
      mRight = uiOn ? Math.min(300, W * 0.18) : 8,
      mLeft = 8;
    // many realms on one screen get smaller name ribbons so that neighbours
    // (Japan beside the two Chinas, the Low Countries) all fit
    let nK = 0;
    for (const c of cand) if (c.prio >= 3 && c.a > 0.01) nK++;
    const kMax = Math.max(20, Math.min(44, H * 0.055) * Math.max(0.62, Math.min(1, 1 - (nK - 8) * 0.022)));
    const world = this.game.world;
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
      // a sprite's on-screen size follows its depth along the view axis, not
      // its straight-line distance (which understates labels away from the
      // centre of a wide view, so neighbours were let overlap)
      const me = cam.matrixWorldInverse.elements,
        P = sp.position;
      const depth = -(me[2] * P.x + me[6] * P.y + me[10] * P.z + me[14]);
      const dist = Math.max(0.01, depth);
      let ph = (sp.scale.y / dist) * fovK;
      let pw = (sp.scale.x / dist) * fovK;
      // cap on-screen size: an anchor close to the camera (e.g. a realm centre
      // just below the view) would otherwise blow its label up across the frame
      const maxPx = c.prio >= 3 ? kMax : 52;
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
      // a realm whose seat lies off screen is not named at the screen edge
      // (it would sit over someone else's land)
      if (target > 0 && c.prio >= 3 && (sx < 0 || sx > W || sy < 0 || sy > H)) target = 0;
      if (target > 0 && c.prio >= 3 && v.z <= 1 && v.z >= -1) {
        // a realm's name is never dropped: fit it to the screen, clamp it into
        // the safe area and nudge it until it no longer collides, staying
        // over the realm's own land
        const top = mTop,
          bot = H - mBot,
          right = W - mRight;
        const avail = right - mLeft;
        if (pw > avail) {
          const k = avail / pw;
          sp.scale.x *= k;
          sp.scale.y *= k;
          pw = avail;
          ph *= k;
        }
        let cx = Math.min(right - pw / 2, Math.max(mLeft + pw / 2, sx)),
          cy = Math.min(bot - ph / 2, Math.max(top + ph / 2, sy));
        const v2 = this._v2 || (this._v2 = new (cam.position.constructor)());
        // A name may sit anywhere that still covers or touches its seat (a
        // small young realm owns far less land than its ribbon spans), or
        // anywhere over the realm's own land.
        const overRealm = (x, y, w2, h2) => {
          if (c.kid == null || !world) return true;
          if (Math.abs(x - sx) <= w2 * 0.5 && Math.abs(y - sy) <= h2 * 1.2) return true;
          v2.set((x / W) * 2 - 1, -((y / H) * 2 - 1), v.z).unproject(cam);
          const tx = Math.floor(v2.x),
            tz = Math.floor(v2.z);
          if (!world.inBounds?.(tx, tz)) return false;
          return world.owner[tz * world.w + tx] === c.kid;
        };
        let placed = false,
          shrink = 1;
        // nearest spots first; failing all of them at full size, try once more
        // with a slightly smaller ribbon before giving the name up
        // (round 27: a third, smaller try and the wider spots below, so a
        // crowded realm such as the Netherlands is nudged aside, not dropped)
        for (const k of [1, 0.8, 0.62]) {
          const w2 = pw * k,
            h2 = ph * k;
          const x0 = Math.min(right - w2 / 2, Math.max(mLeft + w2 / 2, sx)),
            y0 = Math.min(bot - h2 / 2, Math.max(top + h2 / 2, sy));
          for (const [dx, dy] of k < 0.7 ? LABEL_SPOTS_WIDE : LABEL_SPOTS) {
            const yy = y0 + dy * h2,
              xx = Math.min(right - w2 / 2, Math.max(mLeft + w2 / 2, x0 + dx * w2));
            if (yy - h2 / 2 < top || yy + h2 / 2 > bot) continue;
            const r = { l: xx - w2 / 2, r: xx + w2 / 2, t: yy - h2 / 2, b: yy + h2 / 2 };
            if (!hits(r) && overRealm(xx, yy, w2, h2)) {
              rect.l = r.l;
              rect.r = r.r;
              rect.t = r.t;
              rect.b = r.b;
              cy = yy;
              cx = xx;
              placed = true;
              break;
            }
          }
          if (placed) {
            shrink = k;
            break;
          }
        }
        if (placed && shrink !== 1) {
          sp.scale.x *= shrink;
          sp.scale.y *= shrink;
          pw *= shrink;
          ph *= shrink;
        }
        if (placed && (cx !== sx || Math.abs(cy - sy) > 0.5)) {
          // move the sprite to the adjusted screen point at the same depth
          v.set((cx / W) * 2 - 1, -((cy / H) * 2 - 1), v.z).unproject(cam);
          // (same view depth, so it keeps the on-screen size measured above)
          sp.position.copy(v);
        }
        if (!placed) target = 0;
      } else if (target > 0) {
        // keep clear of the screen edges where the HUD lives
        if (rect.t < mTop || rect.b > H - mBot || rect.r > W - mRight || rect.l < mLeft) target = 0;
        if (hits(rect)) target = 0;
      }
      // (each placed name keeps a margin round it, so two realm ribbons never
      // sit edge to edge: round 24 had two nearly touching on the overview)
      // (round 27: only a clearly visible name reserves its place; a faint
      // realm ribbon fading in no longer drops its capital's name, Taipei
      // under the ROC's on the whole Earth)
      if (target > 0.3) {
        const gx = c.prio >= 3 ? 14 : 5,
          gy = c.prio >= 3 ? 6 : 2;
        taken.push({ l: rect.l - gx, r: rect.r + gx, t: rect.t - gy, b: rect.b + gy });
      }
      const f = sp.userData.fade ?? target;
      const nf = f + (target - f) * Math.min(1, dt * 6);
      sp.userData.fade = nf;
      sp.material.opacity = nf;
      sp.visible = nf > 0.01;
    }
  }
}
