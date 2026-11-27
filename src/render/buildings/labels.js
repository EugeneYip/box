import * as THREE from 'three';
import { drawBanner, bannerDataURL } from './emblems.js';
import { BUILDING } from '../../core/scale.js';
import { SEA_LEVEL } from '../../world/constants.js';
import { geoWrapX } from '../../world/geo.js';

// Floating map labels: kingdom names over capitals (mid and far zoom), village
// names (mid zoom), and crossed-swords markers over active battles. Canvas
// sprites in the Cinzel display face, sized by camera distance so they stay
// readable at every zoom, and faded out close to the ground.

const FONT = 'Cinzel, "Cinzel Variable", Georgia, "Times New Roman", serif';

// (round 29) while town names are on screen a realm's ribbon is drawn at least
// this many times a town label's height (its letters about 1.3x a town's: the
// ribbon's letters fill a smaller share of its sprite). Round 28 shrank every
// ribbon by the number of realms in the whole world, so on the whole Earth
// "ROC" was 6 px against HONG KONG's 14.
const TOWN_H = 0.029; // a town label's world height per unit of distance
// (round 31) a realm ribbon's capitals are clamped to about 12-16 px on screen
// at every zoom (16-18 px caps on 300 px plates covered the towns on the 256
// map at 90-110 tiles; 8-9 px on the region overviews), and stay at least
// 1.3x the capitals of the town names shown with them
const RIBBON_CAP_MIN = 12;
const RIBBON_CAP_MAX = 16;
const RIBBON_CAP_FLOOR = 10.5; // a crowded overview may shrink to this before a name is left out
const RIBBON_OVER_TOWN_CAPS = 1.3;
// (round 33) once more than this many ribbons are in view their capitals step
// down to RIBBON_CAP_CROWD px (and to 11 px past nine), and on a phone they
// stay near 12 px
const RIBBON_CROWD = 6;
const RIBBON_CAP_CROWD = 12;
// (round 33) a town label's on-screen height is set by the screen's height,
// but never by more than 1.35x its width (a portrait phone drew town names
// with 15 px capitals, so the ribbons over them had to be 20 px)
const townScreenK = (W, H) => Math.min(1, (1.35 * W) / Math.max(1, H));
// (round 33) how many realm names one screen may hold, by land share: 13
// ribbons covered the 256 map at dusk; real countries have shorter names
// (round 37) at the overview zoom of a World Map world, where the ribbons are
// at their smallest, one per 32000 px (16 on a 960 x 540 screen): with 13 the
// Vast overview could name its largest realms or Europe and Africa, not both
function ribbonCap(W, H, wm, ov = false) {
  const phone = Math.min(W, H) < 500;
  if (phone) return wm ? 4 : 3;
  const n = Math.round((W * H) / (wm ? (ov ? 32000 : 40000) : 70000));
  return wm ? Math.max(6, Math.min(16, n)) : Math.max(5, Math.min(8, n));
}
// a realm is named at mid zoom when it holds at least this share of the land in view
const LAND_SHARE = 0.05;

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
    // (round 31) pale realm colors (Italy, Belgium, the ROC) get a darker
    // plate, so the stripes and the name keep their contrast over bright land
    const lum = (0.2126 * ((color >> 16) & 255) + 0.7152 * ((color >> 8) & 255) + 0.0722 * (color & 255)) / 255;
    x.fillStyle = `rgba(14,16,24,${(0.62 + 0.24 * smooth(0.45, 0.78, lum)).toFixed(3)})`;
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
  // (round 33) the part of the sprite that is drawn (the ribbon's plate or
  // the town's pill), as shares of its width and height from the top left:
  // the HUD and overlap tests use it, not the transparent margin round it
  {
    const ph = big ? px * 0.95 : px + 8,
      py = big ? cy : cy + 1,
      ix = big ? 8 : 2;
    sp.userData.plate = { l: ix / c.width, r: 1 - ix / c.width, t: (py - ph / 2) / c.height, b: (py + ph / 2) / c.height };
  }
  // capital height as a share of the sprite's (sizes are set in capitals on screen)
  // (round 33: measured from the alphabetic baseline; from the middle
  // baseline the ascent was about half the capital's height, so every ribbon
  // was drawn about 1.5x its intended size: 18 px capitals for 12)
  let capPx = px * 0.7;
  try {
    x.textBaseline = 'alphabetic';
    const m = x.measureText('H');
    if (m.actualBoundingBoxAscent > 0) capPx = m.actualBoundingBoxAscent;
  } catch {
    /* no text metrics */
  }
  sp.userData.capK = capPx / c.height;
  // (round 35) where the banner's middle sits, as a share of the sprite's
  // width from its left: a small realm's ribbon is pinned by its banner
  sp.userData.flagX = bw ? 43 / c.width : null;
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
      // (drawn over the finished frame, already tone mapped)
      toneMapped: false,
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
    // (round 33) the labels are drawn over the finished frame, after depth of
    // field, haze, bloom and grade: inside the scene the miniature lens
    // blurred them on phones (a ribbon took the blur of the ground behind it)
    const pl = game.pipeline;
    if (pl?.afterRender) {
      this.overlay = new THREE.Scene();
      this.overlay.name = 'civ-labels:overlay';
      this.batch = new LabelBatch(this.overlay);
      pl.afterRender.push((r) => this._drawOverlay(r));
    } else this.batch = new LabelBatch(this.group);
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

  // draws the label batch over the frame on screen (no clear, no tone map)
  _drawOverlay(r) {
    const m = this.batch.mesh;
    const cam = this.game.cameraRig?.camera;
    if (!m.visible || !m.count || !cam) return;
    const ac = r.autoClear;
    r.autoClear = false;
    r.setRenderTarget(null);
    r.render(this.overlay, cam);
    r.autoClear = ac;
  }

  clear() {
    for (const s of [...this.kLabels.values(), ...this.vLabels.values()]) this.group.remove(s);
    this.kLabels.clear();
    this.vLabels.clear();
    this.batch.reset();
    for (const sp of this.swords) sp.userData.rect = null;
    // rebuild on the very next update: the sync timer runs on drawn-frame
    // time, and on a slow GPU (one frame every few seconds) waiting it out
    // left every realm and town unnamed for a minute after the font loaded
    this._syncT = 0;
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
    // (round 33) on wall-clock time: on drawn-frame time (capped at 0.1 s a
    // frame) a slow GPU named a new realm or town only after a minute
    const nowS = performance.now();
    const rdt = Math.min(1, (nowS - (this._syncAt || nowS)) / 1000);
    this._syncAt = nowS;
    this._syncT = (this._syncT || 0) - rdt;
    if (this._syncT <= 0) {
      this._syncT = 0.75;
      this._sync();
    }
    // (round 31) in the Overview the HTML realm names stand in for these: the
    // sprites are not drawn at all (they showed under the HTML names there)
    const ui = g.ui;
    if (ui?._overview && !ui.title?.active && !ui.root?.classList?.contains('is-photo')) {
      for (const m of [this.kLabels, this.vLabels]) for (const sp of m.values()) (sp.visible = false), (sp.userData.fade = 0), (sp.material.opacity = 0);
      for (const sp of this.swords) sp.visible = false;
      this.batch.draw([this.vLabels, this.kLabels, this.swords]);
      return;
    }
    const D = rig.cur.dist;
    const cam = rig.camera.position;
    const w = g.world;
    // (round 27) realm names take over from town names in a narrow band
    // (50-56 tiles) instead of a half tone from 34 to 70, so between 40 and 80
    // every name on screen is drawn solid: the town names below the band, the
    // realm's name above it (its capital's name stays if the realm is not named)
    // (round 31) on World Map worlds the countries are named from 50 tiles
    // (they came only by 54-65), so the band ends there
    const wm = g.params?.preset === 'earth';
    // (round 33) every name is shown fully or not at all: the realm names come
    // on at one distance (50 tiles on World Map worlds, 53 elsewhere) with no
    // half tone over a band of zoom (52 tiles drew them at a quarter)
    const kA = D >= (wm ? 47.5 : 53) ? 1 : 0;
    // far zoom keeps only kingdom names
    const z01 = this.game.view?.zoom01 ?? 0;
    // (round 29: a short fade band at 19-22 tiles, not 18-30, so a town's
    // name never hangs over its hall as a washed-out outline)
    // (round 31: switched on at 21 with no in-between: a half-faded name had
    // its pale letters left over a plate too faint to see)
    // (round 33: and off again at 155 tiles, also with no in-between)
    const vA = D >= 21 && D < 155 && z01 < 0.475 && !this.game.view?.far ? 1 : 0;
    const cand = [];
    // mid-zoom: only the realm in view and its neighbours are named (all of
    // them at the overview); close in, only the realm in view
    // (round 33: the overview's "all of them" begins at 145 tiles; between
    // 120 and 170 the others were drawn at part strength, so the Europe
    // overview showed Norway, Poland and Portugal half faded)
    const mid = D < 170;
    const midOnly = D < 145;
    this._midOnly = midOnly;
    const now = performance.now();
    if (!mid) this._focusK = -1;
    if (kA > 0 && (!this._landT || now - this._landT > 400 || Math.abs(D - (this._landD || 0)) > D * 0.08)) {
      // what each realm holds of the land in view, read every 0.4 s
      this._landT = now;
      this._landD = D;
      this._landOnScreen(rig, w);
      this._landTotals();
    }
    if (mid && (this._focusT === undefined || now - this._focusT > 400)) {
      this._focusT = now;
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
      this._focusK = fk;
      if (fk >= 0) show.add(fk);
      // (round 29) every realm with a fair share of land on screen is named
      // too: on World Map worlds from the moment realm names take over, so
      // Europe at 90 tiles no longer names the Netherlands alone
      // (round 31) "a fair share" is at least 5% of the land in view, and the
      // whole screen is sampled (less the open inspector), so the neighbors
      // are named from 50 tiles; a bordering realm with a sliver in view no
      // longer adds a ribbon
      if (D > (wm ? 45 : 80) && this._landIds) for (const id of this._landIds) show.add(id);
    }
    // (round 33) when two names collide the realm with more of the land in
    // view keeps its name (then the larger realm, then the more populous);
    // the realm under the camera comes first, and a name already shown keeps
    // a small lead so that two near equals do not take turns
    const cnt = this._landCnt,
      tot = this._landTot;
    const nLand = Math.max(1, this._landN || 0),
      maxTot = Math.max(1, this._landMax || 0);
    // (round 35) names are ranked by the land each realm holds in view, and
    // the realm with the most of it is always placed first (the realm under
    // the camera only breaks near ties): at 60 tiles Khaveh, the largest
    // realm in view with its capital on screen, was left unnamed
    // (round 37) at the overview zoom (where every realm is named) they are
    // ranked by their claim on the land: the whole of it and what is in view,
    // so the largest realms always place before the small ones (Russia and
    // Australia went unnamed on the Vast overview: they owned no sample of
    // the land in view and too little of the whole). The map's own order of
    // importance breaks near ties among the small realms.
    const ov = !midOnly;
    const ccnt = this._claimCnt,
      claim = this._landClaim;
    const maxClaim = Math.max(1, this._claimMax || 0);
    const inView = ov ? ccnt : cnt;
    let topK = -1,
      topN = 0;
    if (inView)
      for (const [id, n] of inView) {
        const k = civ.kingdoms[id];
        if (n > topN && k?.alive && k.villages.length && civ.villages[k.capital]?.alive) (topN = n), (topK = id);
      }
    this._topK = topK;
    for (const [id, s] of this.kLabels) {
      const k = civ.kingdoms[id];
      const v = k && k.alive && k.villages.length ? civ.villages[k.capital] : null; // no names for fallen realms
      const kAk = midOnly && this._focusSet?.size && !this._focusSet.has(id) ? 0 : kA;
      if (!v || !v.alive || kAk < 0.01) {
        s.visible = false;
        s.userData.fade = 0;
        continue;
      }
      let ax = k.labelX ?? v.cx,
        az = k.labelZ ?? v.cz;
      s.userData.seat = v;
      // (round 31) a realm with a fair share of the land in view whose seat
      // lies off screen is named over its own land in view (Mainland Region
      // over the coast round Wuhan, its capital far to the north)
      const la = mid && this._focusSet?.has(id) ? this._landAt?.get(id) : null;
      if (la) {
        const q = (this._q3 = this._q3 || new THREE.Vector3()).set(ax, w.surfaceAt(ax, az), az).project(rig.camera);
        if (q.z > 1 || q.z < -1 || Math.abs(q.x) > 0.94 || Math.abs(q.y) > 0.9) {
          ax = la.x;
          az = la.z;
          s.userData.seat = null;
        }
      }
      const y = w.surfaceAt(ax, az) + 2.5 * BUILDING.scale + D * 0.03;
      s.position.set(ax, y, az);
      const dist = cam.distanceTo(s.position);
      // (the size is clamped on screen in _declutter)
      const h = Math.max(1.4, dist * 0.032);
      s.scale.set(h * s.userData.aspect, h, 1);
      const focus = id === this._focusK;
      const rank = ov
        ? (id === topK ? 3 : 0) + (claim?.get(id) || 0) / maxClaim + (0.5 * (ccnt?.get(id) || 0)) / nLand + 0.6 * this._importance(k) + Math.min(0.05, (k.population || 0) * 1e-5) + (s.userData.fade > 0.5 ? 0.03 : 0)
        : (id === topK ? 3 : 0) + (focus ? 0.25 : 0) + (cnt?.get(id) || 0) / nLand + (0.25 * (tot?.get(id) || 0)) / maxTot + Math.min(0.05, (k.population || 0) * 1e-5) + (s.userData.fade > 0.5 ? 0.03 : 0);
      cand.push({ s, a: kAk, kind: 'realm', key: 10 + rank, kid: id, focus });
    }
    const townK = townScreenK(innerWidth, innerHeight);
    for (const [id, s] of this.vLabels) {
      const v = civ.villages[id];
      const k = civ.kingdoms[v?.kingdom];
      const isCap = k && k.capital === id;
      if (!v || vA < 0.01) {
        s.visible = false;
        s.userData.fade = 0;
        continue;
      }
      const y = w.surfaceAt(v.cx, v.cz) + 1.6 * BUILDING.scale + D * 0.02;
      s.position.set(v.cx, y, v.cz);
      const dist = cam.distanceTo(s.position);
      // (about 12 px capitals on screen: at 0.02 a town's name was ~8 px
      // capitals at 30 tiles, hard to read)
      const h = Math.max(0.8, dist * TOWN_H * townK);
      s.scale.set(h * s.userData.aspect, h, 1);
      if (s.userData.capK) this._townCapK = s.userData.capK;
      // (round 27) a capital gives way only to its realm's name actually on
      // screen, not to the zoom alone (round 33: decided in _declutter once
      // the ribbons are placed, so the two never cross-fade)
      cand.push({ s, a: vA, kind: 'town', key: (isCap ? 2 : 1) + Math.min(0.99, (v.pop || 0) * 0.001), capOf: isCap ? k.id : -1 });
    }
    // battle markers
    const battles = civ.battles || [];
    while (this.swords.length < battles.length) {
      const sp = labelNode(this.swordCanvas);
      sp.userData.aspect = 1;
      this.swords.push(sp);
    }
    for (const sp of this.swords) if (!sp.userData.rect) this._pack(sp);
    const sA = D >= 20 ? 1 : 0;
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
      cand.push({ s: sp, a: sA, kind: 'swords', key: 5 });
    }
    this._townOn = vA;
    this._declutter(cand, dt);
    this.batch.draw([this.vLabels, this.kLabels, this.swords]);
  }

  // Realms owning at least two of a grid of ground points across the screen's
  // open area (inside the HUD margins).
  _landOnScreen(rig, w) {
    const out = (this._landIds = this._landIds || new Set());
    out.clear();
    const cam = rig.camera;
    if (!w?.owner || !cam) return out;
    const V = cam.position.constructor;
    const p = this._lp || (this._lp = new V()),
      d = this._ld || (this._ld = new V());
    const y0 = w.surfaceAt?.(rig.cur.x, rig.cur.z) ?? 0;
    const cnt = (this._landCnt = this._landCnt || new Map());
    cnt.clear();
    const pts = (this._landPts = this._landPts || new Map());
    pts.clear();
    // (round 33: a finer grid, 19 x 11; the counts also rank the names)
    // (round 35: 27 x 15, so a narrow country such as Italy or Vietnam has
    // land samples to hang its name from and is ranked by what it holds)
    const NX = 27,
      NY = 15;
    // the open inspector card hides the screen right of its left edge
    let x1 = 0.97;
    try {
      const ins = document.querySelector('.ws-insp.is-open');
      const r = ins?.getBoundingClientRect();
      if (r && r.width > 0 && r.left > innerWidth * 0.3) x1 = Math.min(x1, r.left / innerWidth - 0.01);
    } catch {
      /* no DOM */
    }
    // (round 37) and each realm's claim in view: what it owns, and on a World
    // Map world the unclaimed land of its real country (ranks the names at
    // the overview, where a realm's own ground is a sample or none)
    const ccnt = (this._claimCnt = this._claimCnt || new Map());
    ccnt.clear();
    const rg = this._realGrid();
    const kOf = rg ? this._realKingdoms() : null;
    let land = 0;
    for (let j = 0; j < NY; j++)
      for (let i = 0; i < NX; i++) {
        const sx = 0.03 + (x1 - 0.03) * (i / (NX - 1)),
          sy = 0.14 + (0.86 - 0.14) * (j / (NY - 1));
        p.set(sx * 2 - 1, -(sy * 2 - 1), 0.5).unproject(cam);
        d.copy(p).sub(cam.position);
        if (d.y >= -1e-6) continue;
        const t = (y0 - cam.position.y) / d.y;
        const x = Math.floor(cam.position.x + d.x * t),
          z = Math.floor(cam.position.z + d.z * t);
        if (!w.inBounds?.(x, z)) continue;
        const o = w.owner[z * w.w + x];
        if (o >= 0) {
          cnt.set(o, (cnt.get(o) || 0) + 1);
          ccnt.set(o, (ccnt.get(o) || 0) + 1);
          if (!pts.has(o)) pts.set(o, []);
          pts.get(o).push(x + 0.5, z + 0.5);
        } else if (rg) {
          const kid = kOf.get(rg.a[Math.floor(z / rg.S) * rg.gw + Math.floor(x / rg.S)]);
          if (kid !== undefined && !w.isWater(x, z)) ccnt.set(kid, (ccnt.get(kid) || 0) + 1);
        }
        if (o >= 0 || (w.height && w.height[z * w.w + x] >= SEA_LEVEL)) land++;
      }
    this._landN = land;
    const need = Math.max(3, Math.ceil(land * LAND_SHARE));
    // (round 33) a realm with less than that share is still named when one
    // of its towns stands on its land in view (Germany round Hamburg on the
    // Europe map at 90 tiles held 4% of the land in view and went unnamed)
    const withTown = (this._landTown = this._landTown || new Set());
    withTown.clear();
    const civ = this.game.civ;
    if (civ)
      for (const v of civ.villages) {
        if (!v?.alive || (cnt.get(v.kingdom) || 0) < 3 || (cnt.get(v.kingdom) || 0) >= need || withTown.has(v.kingdom)) continue;
        const tx = Math.floor(v.cx),
          tz = Math.floor(v.cz);
        if (!w.inBounds?.(tx, tz) || w.owner[tz * w.w + tx] !== v.kingdom) continue;
        p.set(v.cx, w.surfaceAt?.(v.cx, v.cz) ?? y0, v.cz).project(cam);
        const sx = p.x * 0.5 + 0.5,
          sy = -p.y * 0.5 + 0.5;
        if (p.z <= 1 && p.z >= -1 && sx >= 0.03 && sx <= x1 && sy >= 0.14 && sy <= 0.86) withTown.add(v.kingdom);
      }
    // each named realm's own land in view: the sample nearest its middle
    const at = (this._landAt = this._landAt || new Map());
    at.clear();
    for (const [id, n] of cnt) {
      if (n < need && !withTown.has(id)) continue;
      out.add(id);
      const P = pts.get(id);
      let mx = 0,
        mz = 0;
      for (let i = 0; i < P.length; i += 2) (mx += P[i]), (mz += P[i + 1]);
      mx /= P.length / 2;
      mz /= P.length / 2;
      let bi = 0,
        bd = Infinity;
      for (let i = 0; i < P.length; i += 2) {
        const d = (P[i] - mx) ** 2 + (P[i + 1] - mz) ** 2;
        if (d < bd) (bd = d), (bi = i);
      }
      at.set(id, { x: P[bi], z: P[bi + 1] });
    }
    return out;
  }

  // The boxes of what can be seen of the HUD: the top bar's pieces, the
  // feed's cards, the camera pad, the coach card, the minimap, the toolbar,
  // the favorites, the open inspector and the other glass panels. Faded-out
  // panels are skipped; a container (the dock, the feed, the toolbar) gives
  // way to the panels inside it, whose boxes are what it shows.
  _readHud(W, H) {
    const out = [];
    try {
      const root = document.getElementById('ui-root') || document.body;
      if (root.classList?.contains('is-photo')) return out;
      const shown = [];
      // (round 35) each element's opacity down from the root, worked out once
      // a read: every panel used to walk and restyle all its ancestors, 70-180
      // ms a read (every 0.4 s) with a Year 600 HUD
      const opOf = new Map();
      const opacity = (a) => {
        if (!a || a === root) return 1;
        let op = opOf.get(a);
        if (op === undefined) {
          const cs = getComputedStyle(a);
          op = cs.visibility === 'hidden' || cs.display === 'none' ? 0 : +cs.opacity * opacity(a.parentElement);
          opOf.set(a, op);
        }
        return op;
      };
      for (const el of root.querySelectorAll('.ws-glass, .ws-feed__item, .ws-campad, .ws-coach, .ws-map, .ws-insp.is-open, .hud-panel, [class*="panel"], [class*="toolbar"], [class*="feed"], [class*="minimap"], [class*="chip"], [class*="badge"], [class*="topbar"], [class*="dock"]')) {
        if (el.closest('.ws-ovlabels')) continue;
        const r = el.getBoundingClientRect();
        if (!(r.width > 4 && r.height > 4 && r.width < W * 0.95 && r.height < H * 0.95)) continue;
        if (r.right < 0 || r.left > W || r.bottom < 0 || r.top > H) continue;
        if (opacity(el) > 0.05) shown.push([el, r]);
      }
      // (a glass panel always counts whole: the toolbar's glass is its
      // ws-dock__panel, and its inner rows leave gaps a ribbon slid into)
      const box = /dock|toolbar|tray|ws-feed(?!__)|mapwrap|panels\b/;
      for (const [el, r] of shown) {
        const cls = typeof el.className === 'string' ? el.className : '';
        if (box.test(cls) && !/\bws-glass\b/.test(cls) && shown.some(([m]) => m !== el && el.contains(m))) continue;
        out.push({ l: r.left, r: r.right, t: r.top, b: r.bottom });
      }
    } catch {
      /* no DOM */
    }
    return out;
  }

  // (round 35) The realm whose town is nearest a tile (-2 when there is no
  // town): unclaimed land counts as the nearest realm's when names are
  // placed, so a name never rests over a neighbor's country before its
  // borders have grown (at the start most of the land is unclaimed). Cells
  // of 4 tiles, remembered for 2 s.
  nearRealm(tx, tz) {
    const civ = this.game.civ,
      w = this.game.world;
    const now = performance.now();
    if (!this._nr || now - this._nrT > 2000) {
      this._nrT = now;
      this._nr = new Map();
      const vs = (this._nrV = []);
      for (const v of civ?.villages || []) if (v?.alive && v.kingdom >= 0 && civ.kingdoms[v.kingdom]?.alive) vs.push(v.cx, v.cz, v.kingdom);
    }
    const key = (tx >> 2) * 65536 + (tz >> 2);
    let r = this._nr.get(key);
    if (r !== undefined) return r;
    const vs = this._nrV,
      W = w.w,
      wrap = !!w.meta?.geo?.wrap;
    const x = (tx & ~3) + 2,
      z = (tz & ~3) + 2;
    let bd = Infinity;
    r = -2;
    for (let i = 0; i < vs.length; i += 3) {
      let dx = Math.abs(vs[i] - x);
      if (wrap && dx > W / 2) dx = W - dx;
      const d = dx * dx + (vs[i + 1] - z) ** 2;
      if (d < bd) (bd = d), (r = vs[i + 2]);
    }
    this._nr.set(key, r);
    return r;
  }

  // Every realm's land in the whole world (tiles it owns), read every 3 s:
  // ranks the names of realms with little or none of the land in view.
  _landTotals() {
    const now = performance.now();
    if (this._totT && now - this._totT < 3000) return;
    this._totT = now;
    const tot = (this._landTot = this._landTot || new Map());
    tot.clear();
    this._landMax = 0;
    const o = this.game.world?.owner;
    const n = this.game.civ?.kingdoms?.length || 0;
    if (!o || !n) return;
    if (!this._totArr || this._totArr.length < n) this._totArr = new Int32Array(n + 16);
    const a = this._totArr;
    a.fill(0);
    for (let i = 0; i < o.length; i++) {
      const k = o[i];
      if (k >= 0 && k < a.length) a[k]++;
    }
    for (let k = 0; k < n; k++)
      if (a[k]) {
        tot.set(k, a[k]);
        if (a[k] > this._landMax) this._landMax = a[k];
      }
    // (round 37) each realm's claim on the land: the tiles it owns and, on a
    // World Map world, the unclaimed land of its real country. At the start a
    // realm owns only the ground round its towns (Russia 131 tiles round
    // Moscow, Australia 84), so owned tiles alone ranked Russia twelfth and
    // Australia nineteenth of 22 on the Vast overview, behind its 13 ribbons
    const claim = (this._landClaim = this._landClaim || new Map());
    claim.clear();
    for (const [k, c] of tot) claim.set(k, c);
    const rg = this._realGrid();
    const kOf = rg ? this._realKingdoms() : null;
    if (rg && kOf.size) {
      const W = this.game.world.w,
        S2 = rg.S * rg.S;
      for (let j = 0; j < rg.gh; j++)
        for (let i = 0; i < rg.gw; i++) {
          const r = rg.a[j * rg.gw + i];
          if (r < 0 || o[rg.z[j] * W + rg.x[i]] >= 0) continue;
          const kid = kOf.get(r);
          if (kid !== undefined) claim.set(kid, (claim.get(kid) || 0) + S2);
        }
    }
    this._claimMax = 0;
    for (const c of claim.values()) if (c > this._claimMax) this._claimMax = c;
  }

  // (round 37) On a World Map world, the real country of the land on a coarse
  // grid over the map (the place data's realm index of the nearest real
  // place, as the civ reads it; -1 for water and land far from any place).
  // Built once per world; null on other worlds.
  _realGrid() {
    const civ = this.game.civ,
      w = this.game.world;
    const places = civ?._places;
    if (this._rgKey === places && this._rgW === w) return this._rg;
    this._rgKey = places;
    this._rgW = w;
    this._rg = null;
    if (!places?.length || !w?.owner || !w.isWater) return null;
    const S = w.w >= 512 ? 8 : 4;
    const gw = Math.ceil(w.w / S),
      gh = Math.ceil(w.h / S);
    const xs = new Int32Array(gw),
      zs = new Int32Array(gh);
    for (let i = 0; i < gw; i++) xs[i] = Math.min(w.w - 1, i * S + (S >> 1));
    for (let j = 0; j < gh; j++) zs[j] = Math.min(w.h - 1, j * S + (S >> 1));
    const a = new Int16Array(gw * gh).fill(-1);
    const reach = civ._placeReach?.any ? (civ._placeReach.any * 2) ** 2 : Infinity;
    const n = places.length;
    const px = new Float32Array(n),
      pz = new Float32Array(n),
      pr = new Int16Array(n);
    for (let i = 0; i < n; i++) (px[i] = places[i].x), (pz[i] = places[i].z), (pr[i] = places[i].realm);
    for (let j = 0; j < gh; j++)
      for (let i = 0; i < gw; i++) {
        const x = xs[i],
          z = zs[j];
        if (w.isWater(x, z)) continue;
        let bd = reach,
          br = -1;
        for (let p = 0; p < n; p++) {
          const dx = px[p] - x,
            dz = pz[p] - z;
          const d = dx * dx + dz * dz;
          if (d < bd) (bd = d), (br = pr[p]);
        }
        a[j * gw + i] = br;
      }
    return (this._rg = { S, gw, gh, a, x: xs, z: zs });
  }

  // (round 37) The living realm of each real country (place data's realm
  // index -> kingdom id), the one with the most towns; read every second.
  _realKingdoms() {
    const now = performance.now();
    if (this._rkm && now - this._rkT < 1000) return this._rkm;
    this._rkT = now;
    const m = (this._rkm = this._rkm || new Map());
    m.clear();
    const civ = this.game.civ;
    const nv = new Map();
    for (const k of civ?.kingdoms || []) {
      if (!k?.alive || !k.villages.length || !(k.realm >= 0) || !civ.villages[k.capital]?.alive) continue;
      if ((nv.get(k.realm) || 0) >= k.villages.length) continue;
      nv.set(k.realm, k.villages.length);
      m.set(k.realm, k.id);
    }
    return m;
  }

  // (round 37) A real realm's standing in its map's list of realms (most
  // important first): 1 for the first, 0 past the last, and at least 0.95
  // for a realm whose cities must exist at the start (docs/REGIONS.md
  // section 4); 0 for a realm that is no real country.
  _importance(k) {
    if (!(k?.realm >= 0)) return 0;
    const data = this.game.civ?._realmData?.();
    if (!data?.length || !data[k.realm]) return 0;
    const imp = 1 - k.realm / Math.max(1, data.length);
    return data[k.realm].must?.length ? Math.max(0.95, imp) : imp;
  }

  // Hide labels that collide with a higher-priority label or with the HUD.
  _declutter(cand, dt) {
    const rig = this.game.cameraRig;
    const cam = rig.camera;
    const W = innerWidth,
      H = innerHeight;
    // (round 33) the HUD's boxes are read again every 0.4 s of wall-clock
    // time: on drawn-frame time (capped at 0.1 s a frame) a slow GPU read
    // them once a minute, so a ribbon placed before the feed's cards came in
    // stayed under them (MAINLAND REGION under the feed on the whole Earth)
    const now = performance.now();
    const fresh = !this._hud || now - (this._hudAt || 0) > 400 || this._hudW !== W || this._hudH !== H;
    if (fresh) {
      this._hudAt = now;
      this._hudW = W;
      this._hudH = H;
      this._hud = this._readHud(W, H);
      // (round 35) realm names also keep out of the tray's whole box (the
      // strip over its glass is where the power bar and the vehicle
      // chooser open; ITALY sat in it, 13 px over the glass)
      this._dockBox = null;
      try {
        const d = document.querySelector('#ui-root:not(.is-photo) .ws-dock');
        const r = d?.getBoundingClientRect();
        if (r && r.width > 4 && r.height > 4 && r.width < W * 0.95 && getComputedStyle(d).visibility !== 'hidden' && +getComputedStyle(d).opacity > 0.05) this._dockBox = { l: r.left, r: r.right, t: r.top, b: r.bottom };
      } catch {
        /* no DOM */
      }
    }
    const uiOn = this.game.params?.ui !== false;
    // HUD-safe margins that scale with the screen (phones and tablets in portrait)
    // (round 31: the right margin is the open inspector's own edge, else
    // small: the panels themselves are in the HUD list)
    if (fresh || this._inspL === undefined) {
      this._inspL = null;
      try {
        const r = document.querySelector('.ws-insp.is-open')?.getBoundingClientRect();
        if (r && r.width > 0 && r.left > W * 0.3) this._inspL = r.left;
      } catch {
        /* no DOM */
      }
    }
    const mTop = uiOn ? Math.min(90, H * 0.1) : 8,
      mBot = uiOn ? Math.min(90, H * 0.12) : 8,
      mRight = uiOn ? (this._inspL != null ? Math.max(12, W - this._inspL + 8) : 12) : 8,
      mLeft = 8;
    const world = this.game.world;
    const fovK = H / (2 * Math.tan((cam.fov * Math.PI) / 360));
    // realms counted for the ribbon size are the ones whose seat is in view
    const vp = this._v3 || (this._v3 = new (cam.position.constructor)());
    let nView = 0;
    // (round 37) and where each realm's capital is on screen: a ribbon over
    // another realm's capital costs more (MAINLAND REGION over Beijing ran
    // out to the Korean peninsula on the Great East Asia overview and left no
    // room for either Korea's name)
    const civ = this.game.civ;
    const seats = (this._seatScr = this._seatScr || []);
    seats.length = 0;
    for (const c of cand)
      if (c.kind === 'realm' && c.a > 0.01) {
        vp.copy(c.s.position).project(cam);
        if (vp.z <= 1 && vp.z >= -1 && Math.abs(vp.x) <= 1 && Math.abs(vp.y) <= 1) nView++;
        const cap = civ.villages[civ.kingdoms[c.kid]?.capital];
        if (!cap) continue;
        vp.set(cap.cx, world.surfaceAt(cap.cx, cap.cz), cap.cz).project(cam);
        if (vp.z <= 1 && vp.z >= -1 && Math.abs(vp.x) <= 1.1 && Math.abs(vp.y) <= 1.1) seats.push((vp.x * 0.5 + 0.5) * W, (-vp.y * 0.5 + 0.5) * H, c.kid);
      }
    this._nView = nView;
    // (round 29) while towns are named, the cap on a ribbon's height stays
    // above a town label's own on-screen height, so a ribbon is never the
    // smaller name
    const townOn = this._townOn || 0;
    const townPx = Math.min(52, TOWN_H * fovK * townScreenK(W, H));
    // (round 31) ribbon capitals in px: 12-16 by screen height, never under
    // 1.3x the town names' capitals while those are shown
    const townCap = townPx * (this._townCapK || 0.42);
    const townFloor = townCap * RIBBON_OVER_TOWN_CAPS * townOn;
    let ribCap = Math.max(Math.min(RIBBON_CAP_MAX, Math.max(RIBBON_CAP_MIN, H * 0.02)), townFloor);
    // (round 33) fewer and smaller names on a crowded screen and on phones:
    // at most ribbonCap() names, by land share; 12 px capitals once more than
    // six are in view (11 px past nine), and near 12 px on a phone
    const maxRib = ribbonCap(W, H, this.game.params?.preset === 'earth', !this._midOnly);
    const nRib = Math.min(maxRib, nView);
    if (nRib > RIBBON_CROWD || Math.min(W, H) < 500) ribCap = Math.min(ribCap, Math.max(nRib > 9 ? 11 : RIBBON_CAP_CROWD, townFloor));
    this._ribCap = ribCap;
    let nPlaced = 0;
    const v = this._v || (this._v = new (cam.position.constructor)());
    // realm names first (by their rank), then battle markers, then towns
    cand.sort((a, b) => b.key - a.key);
    const taken = [];
    // (round 33) fades run on wall-clock time and take 0.2 s: on drawn-frame
    // time a slow GPU (a frame every few seconds) showed names half faded
    const rdt = Math.min(0.5, (now - (this._fadeAt || now)) / 1000);
    this._fadeAt = now;
    const ribOn = (this._ribOn = this._ribOn || new Set());
    ribOn.clear();
    // tests of the ground under the screen allowed this frame (see the realm
    // names' spot search)
    this._gBudget = 6000;
    // (round 37) the town names that will be on screen, as plates: a ribbon
    // over one costs more, so it moves aside when it can (the United States'
    // ribbon covered Denver's name on the North America map at 60 tiles)
    const towns = (this._townScr = this._townScr || []);
    towns.length = 0;
    if (townOn > 0.5)
      for (const c of cand) {
        if (c.kind !== 'town' || c.a < 0.01) continue;
        const P = c.s.position;
        v.copy(P).project(cam);
        if (v.z > 1 || v.z < -1) continue;
        const me = cam.matrixWorldInverse.elements;
        const dist = Math.max(0.01, -(me[2] * P.x + me[6] * P.y + me[10] * P.z + me[14]));
        let ph = (c.s.scale.y / dist) * fovK,
          pw = (c.s.scale.x / dist) * fovK;
        if (ph > 52) (pw *= 52 / ph), (ph = 52);
        const sx = (v.x * 0.5 + 0.5) * W,
          sy = (-v.y * 0.5 + 0.5) * H;
        const pl = c.s.userData.plate || { l: 0, r: 1, t: 0, b: 1 };
        const l = sx - pw / 2 + pl.l * pw,
          r = sx - pw / 2 + pl.r * pw,
          t = sy - ph / 2 + pl.t * ph,
          b = sy - ph / 2 + pl.b * ph;
        if (r < 0 || l > W || b < 0 || t > H) continue;
        towns.push(l, t, r, b, c.capOf);
      }
    for (const c of cand) {
      const sp = c.s;
      v.copy(sp.position).project(cam);
      let target = c.a;
      if (v.z > 1 || v.z < -1) target = 0;
      // a capital's name gives way to its realm's name placed this frame
      if (c.kind === 'town' && c.capOf >= 0 && ribOn.has(c.capOf)) target = 0;
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
      if (c.kind === 'realm' && ph > 0) {
        // a ribbon is drawn at its clamped capital size at every zoom
        const k = ribCap / (sp.userData.capK || 0.36) / ph;
        sp.scale.x *= k;
        sp.scale.y *= k;
        ph *= k;
        pw *= k;
      }
      const maxPx = c.kind === 'realm' ? Infinity : 52;
      if (ph > maxPx) {
        const k = maxPx / ph;
        sp.scale.x *= k;
        sp.scale.y *= k;
        ph = maxPx;
        pw *= k;
      }
      const rect = { l: sx - pw / 2, r: sx + pw / 2, t: sy - ph / 2, b: sy + ph / 2 };
      // (round 33) the overlap and HUD tests use the drawn plate, not the
      // sprite's transparent margin
      const pl = sp.userData.plate;
      const plateOf = (r) => {
        if (!pl) return r;
        const rw = r.r - r.l,
          rh = r.b - r.t;
        return { l: r.l + pl.l * rw, r: r.l + pl.r * rw, t: r.t + pl.t * rh, b: r.t + pl.b * rh };
      };
      const hits = (r) => {
        const q = plateOf(r);
        for (const o of taken) if (q.l < o.r && q.r > o.l && q.t < o.b && q.b > o.t) return true;
        if (uiOn) {
          // a few px clear of every panel
          const M = c.kind === 'realm' ? 5 : 2;
          for (const h of this._hud) if (q.l - M < h.r && q.r + M > h.l && q.t - M < h.b && q.b + M > h.t) return true;
        }
        return false;
      };
      if (target > 0 && c.kind === 'realm' && nPlaced >= maxRib) target = 0;
      if (target > 0 && c.kind === 'realm' && v.z <= 1 && v.z >= -1) {
        // (round 33) a realm's name sits on its own land: on its capital, on
        // the middle of its land or on its land in view, never more than
        // about 40 px from that point and never with its middle over another
        // realm or the open sea (round 32 had the United Kingdom south of
        // Britain, Germany over the North Sea and North Korea 150 px west of
        // Korea). Failing every such spot clear of the other names and the
        // HUD, at full size and a little smaller, the name is left out.
        const top = mTop,
          bot = H - mBot,
          right = W - mRight;
        const avail = right - mLeft;
        const plW = pl ? pl.r - pl.l : 1;
        if (pw * plW > avail) {
          const k = avail / (pw * plW);
          sp.scale.x *= k;
          sp.scale.y *= k;
          pw *= k;
          ph *= k;
        }
        const v2 = this._v2 || (this._v2 = new (cam.position.constructor)());
        const camP = cam.position;
        // the owner of the ground under a point of the screen (the plane at
        // height gy): a realm id, -1 open water, -2 unowned land, -3 off the map
        // (round 37: `unowned` is set when the answer is unclaimed land that
        // counts as the nearest town's realm's)
        let unowned = false;
        const groundOwner = (x, y, gy) => {
          unowned = false;
          v2.set((x / W) * 2 - 1, -((y / H) * 2 - 1), 0.5).unproject(cam).sub(camP);
          if (v2.y >= -1e-6) return -3;
          let t = (gy - camP.y) / v2.y;
          // two steps onto the ground's own height (hills and coasts lie
          // off the plane through the anchor)
          for (let i = 0; i < 2; i++) {
            const hx = geoWrapX(world, camP.x + v2.x * t),
              hz = camP.z + v2.z * t;
            if (!world.inBounds?.(Math.floor(hx), Math.floor(hz))) break;
            t = (world.surfaceAt(hx, hz) - camP.y) / v2.y;
          }
          const tx = Math.floor(geoWrapX(world, camP.x + v2.x * t)),
            tz = Math.floor(camP.z + v2.z * t);
          if (!world.inBounds?.(tx, tz)) return -3;
          const o = world.owner[tz * world.w + tx];
          if (o >= 0) return o;
          // (round 35) unclaimed land is the nearest town's realm's
          if (world.isWater?.(tx, tz)) return -1;
          unowned = true;
          return this.nearRealm(tx, tz);
        };
        const toScreen = (x, y, z) => {
          v2.set(x, y, z).project(cam);
          if (v2.z > 1 || v2.z < -1) return null;
          const qx = (v2.x * 0.5 + 0.5) * W,
            qy = (-v2.y * 0.5 + 0.5) * H;
          return qx >= 0 && qx <= W && qy >= 0 && qy <= H ? [qx, qy] : null;
        };
        // the points a name may hang from, on screen
        const k = this.game.civ.kingdoms[c.kid];
        const seat = this.game.civ.villages[k?.capital];
        const anchors = [];
        let townTop = null;
        if (seat?.alive !== false && seat) {
          const gy = world.surfaceAt(seat.cx, seat.cz);
          const a = toScreen(seat.cx, gy, seat.cz);
          if (a) {
            anchors.push({ kind: 'seat', x: a[0], y: a[1], gy, wx: seat.cx, wz: seat.cz });
            // the top of the capital's houses on screen (its four sides projected)
            const R = Math.max(1.5, (seat.radius || 4) * 0.5);
            for (const [ox, oz] of [[-R, 0], [R, 0], [0, -R], [0, R], [0, 0]]) {
              v2.set(seat.cx + ox, gy, seat.cz + oz).project(cam);
              if (v2.z > 1 || v2.z < -1) continue;
              const yy = (-v2.y * 0.5 + 0.5) * H;
              townTop = townTop == null ? yy : Math.min(townTop, yy);
            }
          }
        }
        if (k?.labelX != null) {
          const gy = world.surfaceAt(k.labelX, k.labelZ);
          const a = toScreen(k.labelX, gy, k.labelZ);
          if (a && !anchors.some((o) => Math.hypot(o.x - a[0], o.y - a[1]) < 24)) {
            const m = { kind: 'mid', x: a[0], y: a[1], gy, wx: k.labelX, wz: k.labelZ };
            // on the overview the middle of the land comes first
            if (!this._midOnly) anchors.unshift(m);
            else anchors.push(m);
          }
        }
        // (round 35) its land in view: the samples nearest the middle of what
        // it holds on screen first, spread at least 36 px apart, up to ten
        // (round 33 tried the middle and a few more: MAINLAND REGION was left
        // out at 54 tiles on the whole Earth though its land filled half the
        // view)
        const lp = this._landPts?.get(c.kid);
        if (lp) {
          const scr = [];
          let mx = 0,
            my = 0;
          for (let i = 0; i < lp.length; i += 2) {
            const gy = world.surfaceAt(lp[i], lp[i + 1]);
            const a = toScreen(lp[i], gy, lp[i + 1]);
            if (!a) continue;
            scr.push({ x: a[0], y: a[1], gy, wx: lp[i], wz: lp[i + 1] });
            mx += a[0];
            my += a[1];
          }
          if (scr.length) {
            mx /= scr.length;
            my /= scr.length;
            for (const p of scr) p.d = (p.x - mx) ** 2 + (p.y - my) ** 2;
            scr.sort((p, q) => p.d - q.d);
            let n = 0;
            for (const p of scr) {
              if (n >= 10) break;
              if (anchors.some((o) => Math.hypot(o.x - p.x, o.y - p.y) < 36)) continue;
              p.kind = 'land';
              anchors.push(p);
              n++;
            }
          }
        }
        let placed = false,
          shrink = 1,
          cx = sx,
          cy = sy;
        // (round 29: while town names are shown a ribbon shrinks only a
        // little, so it stays larger than them; round 31: never below about
        // 1.3x the town names, nor under about 10.5 px capitals)
        const tries = (townOn > 0.5 ? [1, 0.92] : [1, 0.9, 0.8]).filter((q, i) => i === 0 || ribCap * q >= RIBBON_CAP_FLOOR);
        // a name left out looks for a spot again only every 0.25 s (the full
        // search is the costly part of a frame with many realms in view)
        if (sp.userData.dropAt && now - sp.userData.dropAt < 250) tries.length = 0;
        // (each test of the ground under a point of the screen counts toward
        // a budget for the frame; past it the names still unplaced wait for
        // the next search)
        if (this._gBudget <= 0) tries.length = 0;
        const last = sp.userData.fade > 0.5 ? sp.userData.spot : null;
        const fK = sp.userData.flagX;
        const kid = c.kid;
        const owner = (x, y, gy) => {
          this._gBudget--;
          return groundOwner(x, y, gy);
        };
        // (round 35) every spot is scored, lower is better, and the first
        // spot scoring 0 is taken: the name's middle and its banner on the
        // realm's own land, and none of its plate over another realm's land
        // (MAINLAND REGION's plate lay over the top of Korea). A small realm
        // whose land is narrower than its name is pinned by its banner, the
        // name running east over the sea, rather than drifting into the sea
        // or a neighbor (both Korea flags sat 60-70 px into the Yellow Sea).
        //   3 for each seventh of the plate over another realm's land
        //   3 for the banner over the sea or unclaimed land, 4 over a neighbor
        //     (so a banner on the land, the name running out over the sea,
        //     beats a name centred on a narrow realm with its banner at sea)
        //   1 for the middle off the realm's land (allowed only when pinned
        //     by the banner, or over unclaimed land near the point), 1 for a
        //     banner-pinned spot, 1 for each tenth the name is shrunk
        // (round 37) at the overview zoom a seventh over a neighbor's
        // unclaimed land costs 1, not 3 (borders there are a few pixels and
        // most of the land is still unclaimed: NORTH KOREA running east over
        // the sea toward Honshu scored 10 and was left out), and the plate
        // over another realm's capital costs 3
        const MAX_SCORE = 8;
        const ovZ = !this._midOnly;
        let best = null;
        // (the costs for capitals and town names under the plate steer the
        // choice but do not count toward MAX_SCORE: a crowded view still
        // names its largest realm)
        let lastBase = 0;
        const score = (px, py, a, dx, dy, mode, pw2, fx, ph2) => {
          const off = Math.hypot(dx, dy);
          const bx = px + fx;
          let s = mode === 'flag' ? 1 : 0;
          if (mode === 'flag') {
            const ob = owner(bx, py, a.gy);
            if (ob !== kid && !(a.kind === 'seat' && Math.abs(dy) <= 14 && Math.abs(bx - a.x) <= 14)) return -1;
            if (ob !== kid) s += 3;
            if (owner(px, py, a.gy) !== kid) s += 1;
          } else {
            const oc = owner(px, py, a.gy);
            if (oc !== kid && !(oc === -2 && off <= 41) && !(a.kind === 'seat' && off <= 14)) return -1;
            if (oc !== kid) s += 1;
            const ob = owner(bx, py, a.gy);
            if (ob !== kid) s += ob >= 0 ? 4 : 3;
          }
          lastBase = s;
          if (s > MAX_SCORE || (best && s >= best.s)) return s;
          let tp = 0;
          {
            const l = px - pw2 / 2 - 3,
              r = px + pw2 / 2 + 3,
              t = py - ph2 / 2 - 3,
              b = py + ph2 / 2 + 3;
            for (let i = 0; i < seats.length; i += 3) if (seats[i + 2] !== kid && seats[i] > l && seats[i] < r && seats[i + 1] > t && seats[i + 1] < b) tp += 3;
            // 2 for each town name under the plate (its own capital's name
            // gives way to it, as before)
            for (let i = 0; i < towns.length; i += 5) if (towns[i + 4] !== kid && towns[i] < r && towns[i + 2] > l && towns[i + 1] < b && towns[i + 3] > t) tp += 2;
            if (best && s + tp >= best.s) return s + tp;
          }
          for (let i = 0; i < 7; i++) {
            const o = owner(px - pw2 / 2 + (pw2 * (i + 0.5)) / 7, py, a.gy);
            if (o >= 0 && o !== kid) {
              s += ovZ && unowned ? 1 : 3;
              if (s > MAX_SCORE || (best && s + tp >= best.s)) break;
            }
          }
          lastBase = s;
          return s + tp;
        };
        for (const q of tries) {
          const w2 = pw * q,
            h2 = ph * q;
          // the plate's size and where the sprite's centre sits below the
          // plate's middle
          const pw2 = w2 * plW,
            ph2 = h2 * (pl ? pl.b - pl.t : 1),
            oy = pl ? (0.5 - (pl.t + pl.b) / 2) * h2 : 0;
          // the banner's middle from the name's middle (it is drawn at the
          // plate's left end)
          const fx = fK != null ? (fK - 0.5) * w2 : -pw2 / 2 + Math.min(16, pw2 * 0.12);
          const d1 = ph2 * 0.85;
          const offs = [[0, 0], [0, -d1], [0, d1], [-20, 0], [20, 0], [-20, -d1], [20, -d1], [-20, d1], [20, d1], [-38, 0], [38, 0], [0, -2 * d1], [0, 2 * d1]].filter(([dx, dy]) => Math.hypot(dx, dy) <= 41);
          // (a pinned name may sit a line above or below, its banner still
          // on the land, and slide its banner a little along the land)
          const flags = [[0, 0], [0, -d1], [0, d1], [-10, 0], [10, 0], [0, -d1 * 0.45], [0, d1 * 0.45], [-10, -d1], [10, -d1], [-10, d1], [10, d1]];
          // a name already shown tries its own spot first, so it does not
          // hop about as the camera moves, and keeps it unless it scores
          // clearly worse than before
          const spots = [];
          let keepS = -1;
          if (last && last.q === q) {
            const gy = world.surfaceAt(last.wx, last.wz);
            const p = toScreen(last.wx, gy, last.wz);
            if (p) {
              const a = { kind: last.kind, x: p[0], y: p[1], gy, wx: last.wx, wz: last.wz };
              const dy = last.mode === 'top' && townTop != null ? townTop - 4 - ph2 / 2 - a.y : last.dy;
              spots.push([a, last.mode === 'flag' ? (last.fb || 0) - fx : last.dx, dy, last.mode]);
              keepS = last.s + 1;
            }
          }
          for (const a of anchors) {
            // (round 31) the first try on the capital sits just above its
            // houses (centred on its seat the ribbon hid the town at 68 tiles)
            if (a.kind === 'seat' && townTop != null) {
              const dy = townTop - 4 - ph2 / 2 - a.y;
              if (dy < -2) spots.push([a, 0, dy, 'top']);
            }
            for (const [dx, dy] of offs) spots.push([a, dx, dy, 'c']);
            for (const [bx, dy] of flags) if (!bx || a.kind !== 'land') spots.push([a, bx - fx, dy, 'flag']);
          }
          let kept = false;
          for (let si = 0; si < spots.length; si++) {
            const [a, dx, dy, mode] = spots[si];
            if (this._gBudget <= 0) break;
            const px = a.x + dx,
              py = a.y + dy;
            const pr = { l: px - pw2 / 2, r: px + pw2 / 2, t: py - ph2 / 2, b: py + ph2 / 2 };
            if (pr.l < mLeft || pr.r > right || pr.t < top || pr.b > bot) continue;
            const r = { l: px - w2 / 2, r: px + w2 / 2, t: py + oy - h2 / 2, b: py + oy + h2 / 2 };
            if (hits(r)) continue;
            const db = uiOn ? this._dockBox : null;
            if (db && pr.l - 5 < db.r && pr.r + 5 > db.l && pr.t - 5 < db.b && pr.b + 5 > db.t) continue;
            // (a point of its land away from the capital and the middle of its
            // land costs 2: at the start the Mainland Region took the
            // Himalaya near Lhasa over Beijing)
            const pre = Math.round((1 - q) * 10) + (a.kind === 'land' && anchors[0]?.kind !== 'land' ? 2 : 0);
            if (best && pre >= best.s) continue;
            let s = score(px, py, a, dx, dy, mode, pw2, fx, ph2);
            if (s < 0) continue;
            s += pre;
            if (best && s >= best.s) continue;
            best = { s, base: lastBase + pre, q, r, px, py: py + oy, spot: { kind: a.kind, wx: a.wx, wz: a.wz, dx, dy, mode, q, s, fb: dx + fx } };
            // the spot held last frame is kept while it scores about as well
            if (si === 0 && keepS >= 0 && s <= keepS) kept = true;
            if (s === 0 || kept) break;
          }
          if (best && (best.s === 0 || kept)) break;
        }
        if (best && best.base <= MAX_SCORE) {
          rect.l = best.r.l;
          rect.r = best.r.r;
          rect.t = best.r.t;
          rect.b = best.r.b;
          cx = best.px;
          cy = best.py;
          placed = true;
          shrink = best.q;
          sp.userData.spot = best.spot;
          sp.userData.dropAt = 0;
        }
        if (placed && shrink !== 1) {
          sp.scale.x *= shrink;
          sp.scale.y *= shrink;
          pw *= shrink;
          ph *= shrink;
        }
        if (placed && (Math.abs(cx - sx) > 0.5 || Math.abs(cy - sy) > 0.5)) {
          // move the sprite to the chosen screen point at the same depth
          v.set((cx / W) * 2 - 1, -((cy / H) * 2 - 1), v.z).unproject(cam);
          // (same view depth, so it keeps the on-screen size measured above)
          sp.position.copy(v);
        }
        if (!placed) {
          target = 0;
          sp.userData.spot = null;
          if (!sp.userData.dropAt || now - sp.userData.dropAt >= 250) sp.userData.dropAt = now;
        }
      } else if (target > 0) {
        // keep clear of the screen edges where the HUD lives
        if (rect.t < mTop || rect.b > H - mBot || rect.r > W - mRight || rect.l < mLeft) target = 0;
        // (round 31) a town name under a realm's ribbon goes at once, not in
        // a slow fade that left WUHAN half drawn under MAINLAND REGION
        if (hits(rect)) {
          target = 0;
          if (c.kind !== 'realm') sp.userData.fade = 0;
        }
      }
      // (each placed name keeps a margin round it, so two realm ribbons never
      // sit edge to edge: round 24 had two nearly touching on the overview)
      // (round 27: only a clearly visible name reserves its place; a faint
      // realm ribbon fading in no longer drops its capital's name, Taipei
      // under the ROC's on the whole Earth)
      // (round 33: a ribbon or town name is shown fully or not at all; one
      // that collides with a higher-ranked name is dropped, not dimmed)
      // (round 37: 8 px at the overview zoom, where the ribbons are smallest
      // and the names many; SOUTH KOREA missed its place between NORTH KOREA
      // and JAPAN on the Great East Asia overview by a pixel)
      if (target > 0.3) {
        const gx = c.kind === 'realm' ? (this._midOnly ? 12 : 8) : 5,
          gy = c.kind === 'realm' ? 6 : 2;
        const q = plateOf(rect);
        taken.push({ l: q.l - gx, r: q.r + gx, t: q.t - gy, b: q.b + gy });
        if (c.kind === 'realm') {
          ribOn.add(c.kid);
          nPlaced++;
        }
      }
      const f = sp.userData.fade ?? target;
      const step = rdt / 0.2;
      const nf = target > f ? Math.min(target, f + step) : Math.max(target, f - step);
      sp.userData.fade = nf;
      sp.material.opacity = nf;
      sp.visible = nf > 0.01;
    }
  }
}
