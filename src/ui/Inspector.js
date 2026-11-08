import * as THREE from 'three';
import { TILE_INFO, FLORA_INFO, SEA_LEVEL, SHALLOW_DEPTH, TILE } from '../world/constants.js';
import { powerIcon, uiIcon, tileTint, hasIcon } from './icons.js';
import { getPower } from '../powers/registry.js';
import { el, esc, safe, hexCss } from './dom.js';

const TILE_POWER = {
  [TILE.GRASS]: 'paint-grass',
  [TILE.FOREST]: 'paint-forest',
  [TILE.JUNGLE]: 'paint-jungle',
  [TILE.SAVANNA]: 'paint-savanna',
  [TILE.DESERT]: 'paint-desert',
  [TILE.SAND]: 'paint-sand',
  [TILE.SWAMP]: 'paint-swamp',
  [TILE.TUNDRA]: 'paint-tundra',
  [TILE.SNOW]: 'paint-snow',
  [TILE.SOIL]: 'paint-soil',
  [TILE.ROCK]: 'paint-rock',
  [TILE.LAVA]: 'paint-lava',
  [TILE.ASH]: 'paint-ash',
  [TILE.FARMLAND]: 'paint-farmland',
  [TILE.ROAD]: 'paint-road',
  [TILE.ICE]: 'paint-ice',
};
const KIND_LABEL = { unit: 'Creature', building: 'Building', village: 'Settlement', kingdom: 'Kingdom', flora: 'Flora', tile: 'Land', info: 'Detail' };
const JOB = {
  woodcutter: ['job-woodcutter', '#d9a466', 'Woodcutter'],
  farmer: ['job-farmer', '#f0cf6a', 'Farmer'],
  builder: ['job-builder', '#e0b47a', 'Builder'],
  miner: ['job-miner', '#b8c4d0', 'Miner'],
  soldier: ['job-soldier', '#ff8a7a', 'Soldier'],
  fisher: ['job-fisher', '#7fc8ff', 'Fisher'],
  king: ['job-king', '#ffd36a', 'Ruler'],
  child: ['job-child', '#ffc3a6', 'Child'],
};
const BUILDING_ICON = [
  [/hall|keep|castle|palace|citadel/, 'found-kingdom', '#ffd36a'],
  [/barrack|tower|wall|gate|fort/, 'job-soldier', '#ff8a7a'],
  [/farm|field|mill|granar|barn/, 'farmland', '#f0cf6a'],
  [/market|trade|shop/, 'trade', '#9fd0ff'],
  [/temple|shrine|chapel|church|monument/, 'bless', '#ffe08a'],
  [/mine|quarry/, 'job-miner', '#b8c4d0'],
  [/lumber|saw|wood/, 'job-woodcutter', '#d9a466'],
  [/dock|pier|fish|harbo/, 'job-fisher', '#7fc8ff'],
  [/smith|forge|work/, 'build', '#e0b47a'],
  [/store|warehouse|treasur/, 'gold', '#ffd36a'],
];
const HIDE_STATS = /^(mood)$/i;
// key stats first: health, then what the subject is doing / its status
const STAT_RANK = [/^(health|hp)$/i, /^(doing|activity|status|state)$/i, /^job$/i, /^(hunger|food)$/i, /^energy$/i, /^(population|age)$/i];
const rankOf = (k) => {
  const i = STAT_RANK.findIndex((re) => re.test(String(k)));
  return i < 0 ? 99 : i;
};

function kindOf(r) {
  if (!r) return 'info';
  if (r.kind) return r.kind;
  if (r.unit) return 'unit';
  if (r.building) return 'building';
  if (r.village) return 'village';
  if (r.kingdom != null && typeof r.kingdom === 'object') return 'kingdom';
  return 'info';
}
const word = (v, words) => words[Math.min(words.length - 1, Math.max(0, Math.floor(v * words.length)))];
const cap = (v) => (typeof v === 'string' && /^[a-z]/.test(v) ? v[0].toUpperCase() + v.slice(1) : v);
const isPhone = () => matchMedia('(max-width: 720px)').matches;

// Inspector panel (desktop card / phone bottom sheet). Shows the top result
// of game.inspect(hit), the other things under the cursor as chips, refreshes
// live, can follow a unit, implements the Selection hook (game.selected +
// 'select') and pins the selection on screen so it stays findable under
// canopy or behind hills.
export class Inspector {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.el = el('aside', { class: 'ws-insp ws-glass', 'aria-live': 'polite' });
    this.pin = el('div', { class: 'ws-pin' }, el('span', { class: 'ws-pin__label' }), el('span', { class: 'ws-pin__stem' }));
    ui.layer.append(this.pin);
    this.hit = null;
    this.results = [];
    this.index = 0;
    this._t = 0;
    this._v = new THREE.Vector3();
    this.expanded = false;
    this.portraits = new WeakMap();
    this.game.events.on('inspect', (hit) => (hit ? this.show(hit) : this.close()));
    this.bindSheet();
  }

  get open() {
    return this.el.classList.contains('is-open');
  }

  tileResult(hit) {
    const g = this.game;
    const W = g.world;
    const tx = Math.max(0, Math.min(W.w - 1, hit.tx ?? Math.floor(hit.x))),
      ty = Math.max(0, Math.min(W.h - 1, hit.ty ?? Math.floor(hit.z)));
    const i = W.idx(tx, ty);
    const hh = W.height[i];
    const water = hh < SEA_LEVEL;
    const info = TILE_INFO[W.type[i]] || TILE_INFO[1];
    const o = W.owner[i];
    const kname = o >= 0 ? safe(() => g.civ.kingdomName(o), null) : null;
    const f = W.flora[i];
    const stats = [];
    stats.push(['Elevation', water ? `${Math.round(-hh * 100).toLocaleString('en-US')} m deep` : `${Math.round(hh * 100).toLocaleString('en-US')} m`]);
    if (!water) {
      stats.push(['Climate', word(W.temperature[i] ?? 0.5, ['Frozen', 'Cold', 'Temperate', 'Warm', 'Scorching'])]);
      stats.push(['Moisture', Math.round((W.moisture[i] ?? 0) * 100) + '%']);
      stats.push(['Fertility', Math.round((info.fertile ?? 0) * 100) + '%']);
      if (f) stats.push(['Growth', FLORA_INFO[f]?.name || 'Plants']);
    }
    if (W.fire[i] > 0) stats.push(['Fire', Math.round(W.fire[i] * 100) + '%']);
    stats.push(['Location', `${tx}, ${ty}`]);
    return {
      priority: -100,
      kind: 'tile',
      tile: { tx, ty, type: W.type[i], water, owner: o },
      title: water ? (hh < SEA_LEVEL - SHALLOW_DEPTH ? 'Deep Ocean' : 'Shallow Water') : info.name,
      subtitle: kname ? `Territory of the ${kname.replace(/^the\s+/i, '')}` : water ? 'Open waters' : 'Unclaimed wilds',
      stats,
      x: tx + 0.5,
      z: ty + 0.5,
    };
  }

  collect(hit) {
    const list = (safe(() => this.game.inspect(hit), []) || []).filter(Boolean);
    if (!list.some((r) => kindOf(r) === 'tile')) list.push(this.tileResult(hit));
    return list;
  }

  show(hit, keepIndex = false) {
    if (!hit) return this.close();
    this.hit = { x: hit.x, z: hit.z, tx: hit.tx ?? Math.floor(hit.x), ty: hit.ty ?? Math.floor(hit.z) };
    this.results = this.collect(this.hit);
    if (!keepIndex) this.index = 0;
    this.track = this.results[this.index];
    this._deadShown = false;
    this.render();
    this.el.classList.add('is-open');
    this.ui.root.classList.add('has-insp');
    this._scrollTop = 0;
    this.applySelection();
    this.queuePortrait();
    if (isPhone()) {
      this.setExpanded(false);
      this.frameAboveSheet();
    }
    this.game.audio?.play?.('ui-open', { volume: 0.35 });
  }

  focusIndex(i) {
    this.index = i;
    this.track = this.results[i];
    this.render();
    this.applySelection();
    this.queuePortrait();
  }

  // One small render of the selection, cached per entity (never continuous).
  queuePortrait() {
    const r = this.track;
    const ref = r?.unit || r?.building;
    if (!ref || this.portraits.has(ref)) return;
    clearTimeout(this._portraitT);
    const same = () => (this.track?.unit || this.track?.building) === ref;
    this._portraitT = setTimeout(async () => {
      if (!same() || this.portraits.has(ref)) return;
      this.portraits.set(ref, ''); // in flight: never render the same subject twice
      let url = null;
      try {
        url = await this.renderPortrait(ref, r.unit ? 'unit' : 'building');
      } catch (err) {
        safe(() => {
          throw err;
        }, null, 'portrait');
      }
      if (url) this.portraits.set(ref, url);
      if (url && same()) this.render();
    }, 90);
  }
  async renderPortrait(ref, kind) {
    const g = this.game;
    const renderer = g.pipeline?.renderer;
    if (!renderer?.readRenderTargetPixels || ref.x == null) return null;
    const S = 112;
    if (!this._rt) {
      this._rt = new THREE.WebGLRenderTarget(S, S, { depthBuffer: true });
      this._rt.texture.colorSpace = THREE.SRGBColorSpace;
      this._pcam = new THREE.PerspectiveCamera(30, 1, 0.05, 600);
      this._pbuf = new Uint8Array(S * S * 4);
      this._pcv = document.createElement('canvas');
      this._pcv.width = this._pcv.height = S;
    }
    const W = g.world;
    const sz = (ref.scale || 1) * (ref.def?.size || 1);
    const h = kind === 'unit' ? 0.9 * sz + 0.2 : 2.6;
    const y0 = ref.y ?? W.surfaceAt(ref.x, ref.z);
    const c = new THREE.Vector3(ref.x, y0 + h * 0.5, ref.z);
    const main = g.cameraRig.camera.position;
    const d = new THREE.Vector3(main.x - c.x, 0, main.z - c.z);
    if (d.lengthSq() < 1e-4) d.set(0, 0, 1);
    d.normalize();
    const dist = kind === 'unit' ? h * 2.4 + 0.9 : 7 + Math.max(ref.w || 2, ref.h || 2) * 1.6;
    const cam = this._pcam;
    cam.position.set(c.x + d.x * dist, c.y + dist * 0.42, c.z + d.z * dist);
    cam.lookAt(c);
    cam.updateProjectionMatrix();
    const prevRT = renderer.getRenderTarget();
    const prevAuto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false; // reuse this frame's shadow maps
    let pending = null;
    try {
      renderer.setRenderTarget(this._rt);
      renderer.clear();
      renderer.render(g.scene, cam);
      // async readback (PBO + fence) avoids a GPU pipeline stall
      if (renderer.readRenderTargetPixelsAsync) pending = renderer.readRenderTargetPixelsAsync(this._rt, 0, 0, S, S, this._pbuf);
      else renderer.readRenderTargetPixels(this._rt, 0, 0, S, S, this._pbuf);
    } finally {
      renderer.setRenderTarget(prevRT);
      renderer.shadowMap.autoUpdate = prevAuto;
    }
    if (pending) await pending;
    const ctx = this._pcv.getContext('2d');
    const img = ctx.createImageData(S, S);
    for (let yy = 0; yy < S; yy++) img.data.set(this._pbuf.subarray((S - 1 - yy) * S * 4, (S - yy) * S * 4), yy * S * 4);
    ctx.putImageData(img, 0, 0);
    return this._pcv.toDataURL('image/png');
  }

  close() {
    if (!this.open) return;
    this.el.classList.remove('is-open');
    this.ui.root.classList.remove('has-insp');
    const rig = this.game.cameraRig;
    if (this.track?.unit && rig.follow === this.track.unit) rig.follow = null;
    this.track = null;
    this.hit = null;
    this.setSelected(null);
    this.pin.classList.remove('is-shown');
  }

  applySelection() {
    const r = this.track;
    if (r?.unit) this.setSelected({ kind: 'unit', ref: r.unit });
    else if (r?.building) this.setSelected({ kind: 'building', ref: r.building });
    else this.setSelected(null);
  }

  setSelected(sel) {
    const g = this.game;
    const prev = g.selected || null;
    if (prev === sel || (prev && sel && prev.ref === sel.ref)) return;
    g.selected = sel;
    g.events.emit('select', sel);
  }

  kingdomTint(r) {
    const u = r.unit;
    const kid = u?.kingdom ?? r.building?.kingdom ?? r.village?.kingdom ?? (typeof r.kingdom === 'object' ? r.kingdom?.id : null) ?? (kindOf(r) === 'tile' ? r.tile?.owner : null);
    if (kid == null || kid < 0) return null;
    return hexCss(safe(() => this.game.civ.kingdomColor(kid), null));
  }

  iconFor(r) {
    const k = kindOf(r);
    if (k === 'unit' && r.unit) {
      const u = r.unit;
      const job = JOB[u.job] || (u.def?.kind === 'humanoid' && u.age < (u.def?.maturity ?? 0) ? JOB.child : null);
      if (job) return { svg: uiIcon(job[0]), tint: job[1], label: job[2] };
      const sp = u.species || u.def?.id;
      const p = getPower('spawn-' + sp) || { id: 'spawn-' + sp, name: u.def?.name || sp, category: 'life' };
      return powerIcon(p);
    }
    if (k === 'tile') {
      if (r.tile?.water) return powerIcon({ id: 'ocean', category: 'terrain' });
      const pid = TILE_POWER[r.tile?.type] || 'paint-grass';
      return { svg: powerIcon({ id: pid, category: 'biome' }).svg, tint: tileTint(r.tile?.type) };
    }
    if (k === 'flora') return powerIcon({ id: hasIcon('plant-' + String(r.title || '').toLowerCase()) ? 'plant-' + String(r.title).toLowerCase() : 'plant-tree', category: 'nature' });
    if (k === 'building') {
      const t = String(r.building?.type || r.title || '').toLowerCase();
      const hit = BUILDING_ICON.find(([re]) => re.test(t));
      return hit ? { svg: uiIcon(hit[1]), tint: hit[2] } : { svg: uiIcon('house'), tint: '#9fbcff' };
    }
    if (k === 'village') return { svg: uiIcon('found-village'), tint: this.kingdomTint(r) || '#9fbcff' };
    if (k === 'kingdom') return { svg: uiIcon('banner'), tint: this.kingdomTint(r) || '#ffd36a' };
    return { svg: uiIcon('info'), tint: '#7fdcec' };
  }

  // A stat value like "32 / 40" or "45%" (or "Well fed (76%)") renders as a meter.
  meter(v) {
    const s = String(v);
    let m = s.match(/^\s*(-?[\d.]+)\s*\/\s*([\d.]+)\s*$/);
    if (m) return Math.max(0, Math.min(1, +m[1] / Math.max(1e-6, +m[2])));
    m = s.match(/(-?[\d.]+)\s*%\s*\)?\s*$/);
    if (m) return Math.max(0, Math.min(1, +m[1] / 100));
    return null;
  }

  render() {
    const r = this.track;
    if (!r) return;
    const k = kindOf(r);
    const ic = this.iconFor(r);
    const u = r.unit;
    const dead = u && u.alive === false;
    const kTint = this.kingdomTint(r);
    const stats = (r.stats || [])
      .filter((s) => Array.isArray(s) && s.length >= 2 && !HIDE_STATS.test(String(s[0])))
      .map((s, i) => [s, i])
      .sort((a, b) => rankOf(a[0][0]) - rankOf(b[0][0]) || a[1] - b[1])
      .map(([s]) => s);
    // lay out cells two per row; a half cell left alone on its row spans both
    const wideOf = stats.map(([, v]) => this.meter(cap(v)) != null || String(cap(v)).length > 16);
    let col = 0;
    for (let i = 0; i < wideOf.length; i++) {
      if (wideOf[i]) {
        if (col === 1) wideOf[i - 1] = true;
        col = 0;
      } else col ^= 1;
    }
    if (col === 1) wideOf[wideOf.length - 1] = true;
    const cells = stats
      .map(([key, v], ci) => {
        v = cap(v);
        const lower = String(key).toLowerCase();
        const m = this.meter(v);
        const bad = /damage|fire|danger/.test(lower);
        const hp = /health|hp/.test(lower);
        const shown = m != null && /\(\s*[\d.]+%\s*\)\s*$/.test(String(v)) ? String(v).replace(/\s*\(\s*[\d.]+%\s*\)\s*$/, '') : v;
        if (m != null)
          return `<div class="ws-cell ws-cell--meter"><span class="ws-cell__k">${esc(key)}</span><span class="ws-cell__v">${esc(shown)}</span><span class="ws-meter ${bad ? 'is-bad' : hp ? 'is-hp' : ''}"><i style="width:${(m * 100).toFixed(1)}%"></i></span></div>`;
        return `<div class="ws-cell${wideOf[ci] ? ' ws-cell--wide' : ''}"><span class="ws-cell__k">${esc(key)}</span><span class="ws-cell__v">${esc(v)}</span></div>`;
      })
      .join('');
    const seenTitles = new Set([r.title]);
    const chips = this.results
      .map((o, i) => ({ o, i }))
      .filter(({ o, i }) => {
        if (i === this.index || seenTitles.has(o.title)) return false;
        seenTitles.add(o.title);
        return true;
      })
      .map(({ o, i }) => {
        const c = this.iconFor(o);
        return `<button class="ws-chip2" type="button" data-i="${i}" style="--tint:${c.tint}" title="${esc(KIND_LABEL[kindOf(o)] || '')}"><span class="ws-chip2__ico">${c.svg}</span><span>${esc(o.title || KIND_LABEL[kindOf(o)])}</span></button>`;
      })
      .join('');
    const following = u && this.game.cameraRig.follow === u;
    const actions = [];
    if (u && !dead) actions.push(`<button class="ws-btn ws-btn--sm ${following ? 'is-on' : ''}" type="button" data-act="follow">${uiIcon('follow')}<span>${following ? 'Following' : 'Follow'}</span><kbd class="ws-key">F</kbd></button>`);
    actions.push(`<button class="ws-btn ws-btn--sm ws-btn--ghost" type="button" data-act="focus">${uiIcon('focus')}<span>Focus</span></button>`);
    const kindLabel = k === 'tile' && r.tile?.water ? 'Waters' : u && ic.label ? ic.label : KIND_LABEL[k] || 'Detail';
    const pref = u || r.building;
    const portrait = pref ? this.portraits.get(pref) : null;

    this.el.style.setProperty('--tint', ic.tint);
    this.el.innerHTML = `
      <div class="ws-insp__grab" data-act="sheet" aria-hidden="true"><i></i></div>
      <header class="ws-insp__head">
        <span class="ws-insp__badge${portrait ? ' has-portrait' : ''}">${portrait ? `<img class="ws-insp__portrait" src="${portrait}" alt=""><span class="ws-insp__glyph">${ic.svg}</span>` : ic.svg}${kTint ? `<i class="ws-insp__kdot" style="--k:${kTint}"></i>` : ''}</span>
        <div class="ws-insp__titles">
          <div class="ws-insp__kind">${esc(kindLabel)}${dead ? ' <em class="ws-insp__dead">Fallen</em>' : ''}</div>
          <h3 class="ws-insp__title">${esc(r.title || 'Unknown')}</h3>
          ${r.subtitle ? `<div class="ws-insp__sub">${kTint ? `<i class="ws-crest" style="--k:${kTint}"></i>` : ''}<span>${esc(r.subtitle)}</span></div>` : ''}
        </div>
        <button class="ws-iconbtn ws-iconbtn--sm ws-insp__x" type="button" aria-label="Close (Esc)" data-act="close">${uiIcon('close')}</button>
      </header>
      ${chips ? `<div class="ws-insp__also" aria-label="Also here">${chips}</div>` : ''}
      ${cells ? `<div class="ws-insp__scroll"><div class="ws-insp__grid">${cells}</div></div>` : ''}
      <div class="ws-insp__actions">${actions.join('')}</div>`;
    const sc = this.el.querySelector('.ws-insp__scroll');
    if (sc) {
      sc.scrollTop = this._scrollTop || 0;
      const hint = () => {
        this._scrollTop = sc.scrollTop;
        sc.classList.toggle('can-scroll', sc.scrollHeight - sc.clientHeight - sc.scrollTop > 4);
        sc.classList.toggle('is-scrolled', sc.scrollTop > 4);
      };
      sc.addEventListener('scroll', hint, { passive: true });
      requestAnimationFrame(hint);
    }
    this.el.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.i != null) return this.focusIndex(+b.dataset.i);
      const act = b.dataset.act;
      if (act === 'close') this.close();
      else if (act === 'follow') this.toggleFollow();
      else if (act === 'focus') this.focusCamera();
      this.game.audio?.play?.('ui-click', { volume: 0.45 });
    };
    this._sig = this.signature();
    this.pin.querySelector('.ws-pin__label').textContent = r.title || '';
    this.pin.style.setProperty('--tint', ic.tint);
  }

  signature() {
    const r = this.track;
    return r ? JSON.stringify([r.title, r.subtitle, r.stats, r.unit?.alive, this.game.cameraRig.follow === r.unit, this.results.length, r.unit?.job]) : '';
  }

  toggleFollow() {
    const u = this.track?.unit;
    if (!u || u.alive === false) return;
    const rig = this.game.cameraRig;
    if (rig.follow === u) rig.follow = null;
    else {
      rig.follow = u;
      rig.goal.dist = Math.min(rig.goal.dist, 34);
    }
    this.render();
  }

  focusCamera() {
    const r = this.track;
    const o = r?.unit || r?.building || r?.village;
    const x = o?.x ?? o?.cx ?? r?.x ?? this.hit?.x,
      z = o?.z ?? o?.cz ?? r?.z ?? this.hit?.z;
    if (x != null) this.game.focus(x, z, Math.min(this.game.cameraRig.goal.dist, 40));
  }

  // ---- phone bottom sheet: drag the grip / header between peek and full
  bindSheet() {
    let start = null;
    this.el.addEventListener('pointerdown', (e) => {
      if (!isPhone() || !e.target.closest('.ws-insp__grab, .ws-insp__head') || e.target.closest('button')) return;
      start = { y: e.clientY, h: this.el.getBoundingClientRect().height, moved: false };
      this.el.setPointerCapture?.(e.pointerId);
      this.el.classList.add('is-dragging');
    });
    this.el.addEventListener('pointermove', (e) => {
      if (!start) return;
      const dy = e.clientY - start.y;
      if (Math.abs(dy) > 4) start.moved = true;
      const h = Math.max(110, Math.min(innerHeight * 0.74, start.h - dy));
      this.el.style.height = h + 'px';
    });
    const end = (e) => {
      if (!start) return;
      const dy = e.clientY - start.y;
      this.el.classList.remove('is-dragging');
      this.el.style.height = '';
      // three snap points: peek, half (default) and full
      const order = ['peek', false, true];
      const cur = order.indexOf(this.expanded);
      if (!start.moved) this.setExpanded(this.expanded === true ? false : true);
      else if (dy > 90 && this.expanded === 'peek') this.close();
      else this.setExpanded(order[Math.max(0, Math.min(2, cur + (dy < -30 ? 1 : dy > 30 ? -1 : 0)))]);
      start = null;
    };
    this.el.addEventListener('pointerup', end);
    this.el.addEventListener('pointercancel', end);
  }
  setExpanded(x) {
    this.expanded = x;
    this.el.classList.toggle('is-expanded', x === true);
    this.el.classList.toggle('is-peek', x === 'peek');
  }
  // Phones: slide the view so the inspected subject sits above the sheet.
  frameAboveSheet() {
    const r = this.track;
    const o = r?.unit || r?.building;
    const rig = this.game.cameraRig;
    if (!o || o.x == null || rig.follow) return;
    const d = rig.goal.dist * 0.24;
    this.game.focus(o.x + Math.sin(rig.goal.yaw) * d, o.z + Math.cos(rig.goal.yaw) * d);
  }

  // Re-query the tracked entity so stats stay live.
  refresh() {
    const r = this.track;
    if (!r) return;
    const u = r.unit,
      b = r.building;
    let at = this.hit;
    if (u) at = { x: u.x, z: u.z, tx: Math.floor(u.x), ty: Math.floor(u.z) };
    else if (b && b.x != null) at = { x: b.x, z: b.z, tx: Math.floor(b.x), ty: Math.floor(b.z) };
    const list = this.collect(at);
    let idx = list.findIndex((o) => (u && o.unit === u) || (b && o.building === b) || (!u && !b && kindOf(o) === kindOf(r) && o.title === r.title));
    if (idx < 0) {
      if (u) {
        if (u.alive === false && !this._deadShown) {
          this._deadShown = true;
          this.render();
        }
        return;
      }
      idx = 0;
    }
    this._deadShown = false;
    this.results = list;
    this.index = idx;
    this.track = list[idx];
    if (u) this.hit = at;
    if (this.signature() !== this._sig) this.render();
  }

  // Screen-space pin over the selection: visible through canopy and hills.
  updatePin() {
    const ref = this.game.selected?.ref;
    const pin = this.pin;
    if (!this.open || !ref || ref.alive === false || ref.x == null || this.ui.root.classList.contains('is-photo')) {
      pin.classList.remove('is-shown');
      return;
    }
    const W = this.game.world;
    const kind = this.game.selected.kind;
    const y = (ref.y ?? W.surfaceAt(ref.x, ref.z)) + (kind === 'building' ? 3.2 : 1.6 * (ref.scale || 1) * (ref.def?.size || 1));
    const v = this._v.set(ref.x, y, ref.z).project(this.game.cameraRig.camera);
    if (v.z > 1 || v.z < -1) {
      pin.classList.remove('is-shown');
      return;
    }
    const x = Math.max(16, Math.min(innerWidth - 16, (v.x * 0.5 + 0.5) * innerWidth));
    const sy = Math.max(70, Math.min(innerHeight - 40, (-v.y * 0.5 + 0.5) * innerHeight));
    pin.style.transform = `translate(${x.toFixed(1)}px, ${sy.toFixed(1)}px)`;
    pin.classList.add('is-shown');
    // a followed or hidden creature keeps its name tag; otherwise show the marker only
    pin.classList.toggle('has-label', this.game.cameraRig.follow === ref || kind === 'building');
  }

  update(dt) {
    if (!this.open) return;
    this.updatePin();
    this._t -= dt;
    if (this._t <= 0) {
      this._t = 0.35;
      safe(() => this.refresh(), null, 'inspector refresh');
    }
  }
}
