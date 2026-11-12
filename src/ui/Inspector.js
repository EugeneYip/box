import * as THREE from 'three';
import { TILE_INFO, FLORA_INFO, SEA_LEVEL, SHALLOW_DEPTH, TILE } from '../world/constants.js';
import { powerIcon, uiIcon, tileTint, hasIcon } from './icons.js';
import { getPower } from '../powers/registry.js';
import { el, esc, safe, hexCss, fmtNum, realmColourText } from './dom.js';
import { traitDef, statusDef, modLines, prettyId, eraNames, techDef, techList } from './depth.js';
import { kingdomOf, eraOf, researchOf } from './TechPanel.js';
import { CULTURES } from '../sim/civ/cultures.js';
import { Editor } from './Editor.js';
import { bannerURL } from './banner.js';
import { YEAR } from '../core/time.js';

const TRAIT_ICON = { body: 'heart', mind: 'sparkle', spirit: 'fire', gift: 'good', scar: 'shield', trait: 'sparkle' };
const STATUS_ICON = {
  burning: 'fire',
  sick: 'plague',
  blessed: 'bless',
  inspired: 'sparkle',
  enraged: 'war',
  chilled: 'weather-snow',
  starving: 'bad',
  exhausted: 'night',
  wounded: 'heal',
  mourning: 'kill',
  frightened: 'bad',
  sleeping: 'night',
};
const SLOT_ICON = { weapon: 'sword', armor: 'shield', tool: 'build', trinket: 'sparkle' };
const INV = {
  food: ['plant-wheat', 'Food'],
  wood: ['job-woodcutter', 'Wood'],
  stone: ['plant-rocks', 'Stone'],
  ore: ['job-miner', 'Ore'],
  gold: ['gold', 'Gold'],
  tools: ['build', 'Tools'],
  weapons: ['sword', 'Weapons'],
  armor: ['shield', 'Armour'],
};

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
const KIND_LABEL = { unit: 'Creature', building: 'Building', village: 'Settlement', kingdom: 'Kingdom', flora: 'Flora', tile: 'Land', info: 'Detail', vessel: 'Vessel', vehicle: 'Vehicle' };
// Fleets (game.fleet.inspect): cargo lines with an icon each
const CARGO_ICON = { settlers: 'found-village', army: 'job-soldier', fish: 'spawn-fish', food: 'plant-wheat', wood: 'plant-tree', stone: 'mountain', ore: 'job-miner', gold: 'gold', goods: 'trade' };
const isCraft = (r) => !!r?.vessel || r?.kind === 'vessel' || r?.kind === 'vehicle';
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
const HIDE_STATS = /^(mood|traits?|level)$/i;
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
    this.editor = new Editor(this);
    this.editing = null;
    this.game.events.on('inspect', (hit) => (hit ? this.show(hit) : this.close()));
    this.bindSheet();
    this.el.addEventListener('pointerdown', () => (this._ptr = true));
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) this.el.addEventListener(ev, () => (this._ptr = false));
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
    const g = this.game;
    const list = (safe(() => g.inspect(hit), []) || []).filter(Boolean);
    if (!list.some((r) => kindOf(r) === 'kingdom')) {
      const v = list.map((r) => r.village || (r.building ? g.civ?.villages?.[r.building.village] : null)).find(Boolean);
      const k = v ? kingdomOf(g, v.kingdom) : null;
      if (k && k.alive !== false) {
        const r = safe(() => g.civ._inspectKingdom?.(k, 1), null) || { priority: 1, kind: 'kingdom', kingdom: k, title: k.name, subtitle: 'Kingdom', stats: [] };
        list.splice(Math.max(1, list.findIndex((x) => kindOf(x) === 'tile')), 0, r);
      }
    }
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
    this._scrollTop = 0;
    this.editing = null;
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
    this._scrollTop = 0;
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
        url = await this.renderPortrait(ref, r.unit ? 'unit' : isCraft(r) ? 'vessel' : 'building');
      } catch (err) {
        safe(() => {
          throw err;
        }, null, 'portrait');
      }
      if (url) this.portraits.set(ref, url);
      if (url && same()) {
        if (this.editing) this.patchPortrait(url);
        else this.render();
      }
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
    const h = kind === 'unit' ? 0.9 * sz + 0.2 : kind === 'vessel' ? 0.9 + (ref.def?.length || 1) * 0.45 : 2.6;
    const y0 = ref.y ?? W.surfaceAt(ref.x, ref.z);
    const c = new THREE.Vector3(ref.x, y0 + h * 0.5, ref.z);
    const main = g.cameraRig.camera.position;
    const d = new THREE.Vector3(main.x - c.x, 0, main.z - c.z);
    if (d.lengthSq() < 1e-4) d.set(0, 0, 1);
    d.normalize();
    const dist = kind === 'unit' ? h * 2.4 + 0.9 : kind === 'vessel' ? 3.2 + (ref.def?.length || 1) * 2.2 : 7 + Math.max(ref.w || 2, ref.h || 2) * 1.6;
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
    this.editing = null;
    this.ui.popover?.hide?.();
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
    else if (isCraft(r)) this.setSelected({ kind: 'vessel', ref: r.vessel || r.building });
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
    if (isCraft(r)) {
      const v = r.vessel || r.building;
      const sea = v?.cls === 'sea' || r.kind === 'vessel';
      return { svg: uiIcon(sea ? 'ship' : v?.def?.siege ? 'catapult' : 'cart'), tint: v?.def?.war || v?.def?.siege ? '#ff8a7a' : sea ? '#7fc8ff' : '#d9a466' };
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
    const craft = isCraft(r) ? r.vessel || r.building : null;
    const dead = (u && u.alive === false) || (craft && (craft.alive === false || craft.state === 'sinking'));
    const kTint = this.kingdomTint(r);
    // a building's own era only matters when it differs from its realm's
    let realmEraName = null;
    if (k === 'building' || k === 'village') {
      const kk = (typeof r.kingdom === 'object' && r.kingdom) || kingdomOf(this.game, (r.village || this.game.civ?.villages?.[r.building?.village])?.kingdom);
      if (kk) realmEraName = `${eraNames()[eraOf(this.game, kk)] || ''} era`.toLowerCase();
    }
    const stats = (r.stats || [])
      .filter((s) => Array.isArray(s) && s.length >= 2 && !HIDE_STATS.test(String(s[0])))
      .filter((s) => !(realmEraName && /^built in$/i.test(String(s[0])) && String(s[1]).toLowerCase() === realmEraName))
      .filter((s) => !(craft && /^(voyage|cargo)$/i.test(String(s[0]))))
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
          return `<div class="ws-cell ws-cell--meter" data-k="${esc(key)}"><span class="ws-cell__k">${esc(key)}</span><span class="ws-cell__v">${esc(shown)}</span><span class="ws-meter ${bad ? 'is-bad' : hp ? 'is-hp' : ''}"><i style="width:${(m * 100).toFixed(1)}%"></i></span></div>`;
        return `<div class="ws-cell${wideOf[ci] ? ' ws-cell--wide' : ''}" data-k="${esc(key)}"><span class="ws-cell__k">${esc(key)}</span><span class="ws-cell__v">${esc(v)}</span></div>`;
      })
      .join('');
    // people listed under "Inside" are not repeated among the chips
    const occIds = kindOf(r) === 'building' && r.building ? new Set((safe(() => this.occupants(r.building), []) || []).map((o) => o.id)) : null;
    const seenTitles = new Set([r.title]);
    const chips = this.results
      .map((o, i) => ({ o, i }))
      .filter(({ o, i }) => {
        if (i === this.index || seenTitles.has(o.title)) return false;
        if (occIds && o.unit && occIds.has(o.unit.id)) return false;
        seenTitles.add(o.title);
        return true;
      })
      .map(({ o, i }) => {
        const c = this.iconFor(o);
        return `<button class="ws-chip2" type="button" data-i="${i}" style="--tint:${c.tint}" title="${esc(KIND_LABEL[kindOf(o)] || '')}"><span class="ws-chip2__ico">${c.svg}</span><span>${esc(o.title || KIND_LABEL[kindOf(o)])}</span></button>`;
      })
      .join('');
    const following = (u || craft) && this.game.cameraRig.follow === (u || craft);
    const actions = [];
    if ((u || craft) && !dead) actions.push(`<button class="ws-btn ws-btn--sm ${following ? 'is-on' : ''}" type="button" data-act="follow">${uiIcon('follow')}<span>${following ? 'Following' : 'Follow'}</span><kbd class="ws-key">F</kbd></button>`);
    actions.push(`<button class="ws-btn ws-btn--sm ws-btn--ghost" type="button" data-act="focus">${uiIcon('focus')}<span>Focus</span></button>`);
    const kindLabel = k === 'tile' && r.tile?.water ? 'Waters' : u && ic.label ? ic.label : craft ? (craft.def?.war ? 'Warship' : craft.def?.siege ? 'Siege engine' : KIND_LABEL[k]) : KIND_LABEL[k] || 'Detail';
    const pref = u || r.building;
    // a realm shows its banner (the same drawing as its flags) in place of a portrait
    const kObj = !pref && kindOf(r) === 'kingdom' && typeof r.kingdom === 'object' ? r.kingdom : null;
    const portrait = pref ? this.portraits.get(pref) : kObj?.banner ? bannerURL(kObj.banner, kObj.color, 72) : null;
    const editable = !!(u ? u.alive !== false : k === 'kingdom' || k === 'village' || (k === 'building' && (r.village || this.game.civ?.villages?.[r.building?.village])));
    const editing = !!this.editing && editable && this.editTarget(r) === this.editing;
    const depth = safe(() => (u ? this.unitDepth(u) : craft ? this.craftDepth(craft, r) : k === 'village' || k === 'kingdom' || k === 'building' ? this.realmDepth(r) : ''), '', 'inspector depth') || '';
    const level = u && Number.isFinite(u.level) ? u.level : null;
    const ownerK = craft ? kingdomOf(this.game, craft.kingdom) : null;
    // the epithet ("the Fierce") only when the title does not carry it already
    const ep0 = u ? u.title || u.data?.title || null : null;
    const epithet = ep0 && !String(r.title || '').toLowerCase().includes(String(ep0).toLowerCase()) ? ep0 : null;
    const fav = !!u?.data?.favorite;
    const realmK = !u && (k === 'village' || k === 'kingdom' || k === 'building') ? (typeof r.kingdom === 'object' && r.kingdom) || kingdomOf(this.game, (r.village || this.game.civ?.villages?.[r.building?.village])?.kingdom) : null;
    if (realmK) actions.unshift(`<button class="ws-btn ws-btn--sm" type="button" data-act="tech" data-k="${realmK.id}">${uiIcon('chronicle')}<span>Technology</span></button>`);

    this.el.style.setProperty('--tint', ic.tint);
    this.el.innerHTML = `
      <div class="ws-insp__grab" data-act="sheet" aria-hidden="true"><i></i></div>
      <header class="ws-insp__head">
        <span class="ws-insp__badge${portrait ? ' has-portrait' : ''}${kObj?.banner ? ' has-banner' : ''}">${level != null ? `<i class="ws-lvl" title="Level ${level}">${level}</i>` : ''}${portrait ? `<img class="ws-insp__portrait" src="${portrait}" alt=""><span class="ws-insp__glyph">${ic.svg}</span>` : ic.svg}${kTint ? `<i class="ws-insp__kdot" style="--k:${kTint}"></i>` : ''}</span>
        <div class="ws-insp__titles">
          <div class="ws-insp__kind">${esc(kindLabel)}${dead ? ` <em class="ws-insp__dead">${craft ? 'Lost' : 'Fallen'}</em>` : ''}</div>
          <h3 class="ws-insp__title">${esc(r.title || 'Unknown')}${epithet ? ` <span class="ws-insp__epithet">${esc(epithet)}</span>` : ''}</h3>
          ${r.subtitle ? `<div class="ws-insp__sub" data-sub>${craft && ownerK?.banner ? `<img class="ws-crest ws-crest--banner" alt="" src="${bannerURL(ownerK.banner, ownerK.color, 28)}">` : kTint ? `<i class="ws-crest" style="--k:${kTint}"></i>` : ''}<span>${esc(this.subText(r))}</span></div>` : ''}
        </div>
        ${editable ? `<button class="ws-iconbtn ws-iconbtn--sm ws-insp__edit${editing ? ' is-on' : ''}" type="button" aria-label="${editing ? 'Done editing' : 'Edit'}" data-tip="${editing ? 'Done editing' : 'Edit name, colours and more'}" data-act="${editing ? 'edit-done' : 'edit'}">${uiIcon(editing ? 'check' : 'edit')}</button>` : ''}
        ${u ? `<button class="ws-iconbtn ws-iconbtn--sm ws-insp__fav${fav ? ' is-on' : ''}" type="button" aria-label="${fav ? 'Unstar' : 'Star this creature'}" data-tip="${fav ? 'Favourite' : 'Mark as favourite'}" data-act="fav">${uiIcon(fav ? 'star-on' : 'star')}</button>` : ''}
        <button class="ws-iconbtn ws-iconbtn--sm ws-insp__x" type="button" aria-label="Close (Esc)" data-act="close">${uiIcon('close')}</button>
      </header>
      ${chips ? `<div class="ws-insp__also" aria-label="Also here">${chips}</div>` : ''}
      ${editing ? '<div class="ws-insp__scroll ws-insp__editwrap"></div>' : `${cells || depth ? `<div class="ws-insp__scroll">${cells ? `<div class="ws-insp__grid">${cells}</div>` : ''}${depth}</div>` : ''}
      <div class="ws-insp__actions">${actions.join('')}</div>`}`;
    const th = this.el.querySelector('.ws-insp__title');
    if (th) this.sizeTitle(th, r.title);
    if (editing) {
      this.el.querySelector('.ws-insp__also')?.remove();
      this.el.querySelector('.ws-insp__editwrap').append(this.editor.build(r));
      this.el.classList.add('is-editing');
    } else this.el.classList.remove('is-editing');
    const sc = this.el.querySelector('.ws-insp__scroll');
    if (sc && this.isCompact()) {
      const more = document.createElement('div');
      more.className = 'ws-insp__more';
      const cells = [...sc.querySelectorAll('.ws-insp__grid > .ws-cell')];
      if (cells.length > 4) {
        const g2 = document.createElement('div');
        g2.className = 'ws-insp__grid';
        for (const c of cells.slice(4)) g2.append(c);
        more.append(g2);
      }
      for (const sec of [...sc.querySelectorAll('.ws-dsec')]) if (!/inside|traits|conditions|learning|realm|voyage|hold/i.test(sec.querySelector('h5')?.textContent || '')) more.append(sec);
      if (more.childElementCount) {
        more.hidden = !this.moreOpen;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ws-insp__morebtn';
        btn.dataset.act = 'more';
        btn.innerHTML = `<span>${this.moreOpen ? 'Fewer details' : 'More details'}</span>${uiIcon(this.moreOpen ? 'chev-up' : 'chev-down')}`;
        sc.append(btn, more);
      }
    }
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
      else if (act === 'edit') {
        this.editing = this.editTarget(this.track);
        if (this.isCompact()) this.setExpanded(true);
        this.render();
        return;
      } else if (act === 'edit-done') {
        this.stopEdit();
        return;
      } else if (act === 'more') {
        this.moreOpen = !this.moreOpen;
        const m = this.el.querySelector('.ws-insp__more');
        if (m) m.hidden = !this.moreOpen;
        b.innerHTML = `<span>${this.moreOpen ? 'Fewer details' : 'More details'}</span>${uiIcon(this.moreOpen ? 'chev-up' : 'chev-down')}`;
        return;
      } else if (act === 'fav' && u) {
        u.data = u.data || {};
        const on = !u.data.favorite;
        if (typeof this.game.units?.setFavorite === 'function') safe(() => this.game.units.setFavorite(u, on), null, 'favorite');
        else u.data.favorite = on;
        if (this.editing) {
          // keep the edit card: flip the star in place
          b.classList.toggle('is-on', !!u.data.favorite);
          b.innerHTML = uiIcon(u.data.favorite ? 'star-on' : 'star');
          b.setAttribute('aria-label', u.data.favorite ? 'Unstar' : 'Star this creature');
          b.dataset.tip = u.data.favorite ? 'Favourite' : 'Mark as favourite';
        } else this.render();
      } else if (act === 'tech') this.ui.modals.open('tech', { kingdom: +b.dataset.k });
      else if (act === 'occupant') {
        const id = +b.dataset.uid;
        const U = this.game.units;
        const who = U?.byId?.get?.(id) || U?.list?.find?.((o) => o.id === id);
        this.showUnit(who);
        return;
      }
      else if (act === 'follow') this.toggleFollow();
      else if (act === 'focus') this.focusCamera();
      this.game.audio?.play?.('ui-click', { volume: 0.45 });
    };
    this._sig = this.signature();
    this._vsig = this.valueSignature();
    this.pin.querySelector('.ws-pin__label').textContent = r.title || '';
    this.pin.style.setProperty('--tint', ic.tint);
  }

  // ---- depth sections (all fields guarded: Life / Civ add them over time)
  chip(text, tip, cls = '', icon = null) {
    return `<span class="ws-tchip ${cls}" ${tip ? `data-tip="${esc(tip)}"` : ''}>${icon ? uiIcon(icon) : ''}<span>${esc(text)}</span></span>`;
  }
  traitChips(ids) {
    const g = this.game;
    return (ids || [])
      .map((id) => {
        const def = traitDef(g, id) || {};
        const cat = def.category || 'trait';
        const tip = [def.description, modLines(def.mods).map((l) => l.text).join(', ')].filter(Boolean).join(' — ');
        const rare = cat === 'gift' || def.rarity === 'rare' || (typeof def.rarity === 'number' && def.rarity > 0 && def.rarity <= 0.015);
        return this.chip(def.name || prettyId(id), tip, `is-${cat}${rare ? ' is-rare' : ''}`, TRAIT_ICON[cat] || 'sparkle');
      })
      .join('');
  }
  // Vessels and vehicles: the voyage as a route with progress, and the cargo hold.
  craftDepth(v, r = null) {
    const g = this.game;
    const civ = g.civ;
    let html = '';
    const vo = v.voyage;
    // the route follows Fleets' own account: none in port, reversed on the way home
    const hasVoyage = r?.stats ? r.stats.some((s) => /^voyage$/i.test(String(s?.[0]))) : !!vo && v.state !== 'moored';
    if (vo && hasVoyage) {
      const homeward = v.mission?.phase === 'home' || v.mission?.type === 'home';
      const homeV = civ?.villages?.[v.home];
      const place = (ref) => (ref && typeof ref === 'object' ? ref : civ?.villages?.[ref]);
      const toRef = place(vo.to);
      const a = homeward ? toRef : place(vo.from) || homeV;
      const b = homeward ? homeV || place(vo.from) : toRef;
      const ax = a?.cx ?? a?.x,
        az = a?.cz ?? a?.z,
        bx = b?.cx ?? b?.x,
        bz = b?.cz ?? b?.z;
      let pct = null;
      if (ax != null && bx != null) {
        const total = Math.hypot(bx - ax, bz - az);
        const left = Math.hypot(bx - v.x, bz - v.z);
        if (total > 1) pct = Math.max(0, Math.min(1, 1 - left / total));
      }
      const fromName = homeward ? vo.toName || 'abroad' : vo.fromName || '—';
      const toName = homeward ? homeV?.name || vo.fromName || 'home' : vo.toName || 'open sea';
      html += `<section class="ws-dsec"><h5>${homeward ? 'Homeward' : 'Voyage'}</h5><div class="ws-voyage"><span class="ws-voyage__end">${esc(fromName)}</span><i class="ws-voyage__track">${pct != null ? `<b style="left:${(pct * 100).toFixed(1)}%"></b>` : ''}</i><span class="ws-voyage__end is-to">${esc(toName)}</span></div></section>`;
    }
    const c = v.cargo;
    if (v.def?.capacity || c) {
      const parts = [];
      if (c) {
        const n = (x) => (Array.isArray(x) ? x.length : x);
        if (c.settlers) parts.push(['settlers', `${n(c.settlers)} settlers`]);
        if (c.army) parts.push(['army', `${n(c.army)} soldiers`]);
        for (const k of ['fish', 'food', 'wood', 'stone', 'ore', 'gold', 'goods']) if (c[k] > 0) parts.push([k, `${Math.round(c[k])} ${k}`]);
      }
      const cap = v.def?.capacity ? ` <small>of ${v.def.capacity}</small>` : '';
      html += `<section class="ws-dsec"><h5>Hold${cap}</h5><div class="ws-chips">${parts.length ? parts.map(([k, t]) => this.chip(t, '', 'is-cargo', CARGO_ICON[k] || 'trade')).join('') : `<span class="ws-insp__muted">Empty</span>`}</div></section>`;
    }
    return html;
  }
  unitDepth(u) {
    const g = this.game;
    let html = '';
    const traits = Array.isArray(u.traits) ? u.traits : [];
    // divine blessings set from the editor (units.setUnitFlag)
    const fl = u.flags || {};
    const bless = [
      fl.immortal && this.chip('Immortal', 'Blessed by the gods: no death from age, hunger or wounds', 'is-blessing', 'sparkle'),
      fl.pacifist && this.chip('Pacifist', 'Sworn to peace: never starts a fight', 'is-blessing', 'peace'),
      fl.frozenAge && this.chip('Ageless', 'Time no longer touches them', 'is-blessing', 'night'),
    ].filter(Boolean);
    if (bless.length) html += `<section class="ws-dsec"><h5>Blessings</h5><div class="ws-chips">${bless.join('')}</div></section>`;
    if (traits.length) html += `<section class="ws-dsec"><h5>Traits</h5><div class="ws-chips">${this.traitChips(traits)}</div></section>`;
    const shown = new Set((this.track?.stats || []).map((s) => String(s[0]).toLowerCase()));
    const st = (u.statuses instanceof Map ? [...u.statuses.entries()] : u.statuses && typeof u.statuses === 'object' ? Object.entries(u.statuses) : []).filter(
      ([id]) => !((id === 'exhausted' && shown.has('energy')) || (id === 'starving' && shown.has('hunger'))),
    );
    if (st.length) {
      html += `<section class="ws-dsec"><h5>Conditions</h5><div class="ws-chips">${st
        .map(([id, secs]) => {
          const def = statusDef(g, id) || {};
          const left = Number.isFinite(secs) ? (secs >= YEAR ? `${Math.ceil(secs / YEAR)}y` : `${Math.ceil(secs)}s`) : '';
          return `<span class="ws-tchip is-status" data-st="${esc(id)}" data-tip="${esc(def.description || '')}">${uiIcon(STATUS_ICON[id] || 'info')}<span>${esc(def.name || prettyId(id))}</span>${left ? `<small>${left}</small>` : ''}</span>`;
        })
        .join('')}</div></section>`;
    }
    const eq = u.equipment && typeof u.equipment === 'object' ? u.equipment : null;
    if (eq) {
      const slots = ['weapon', 'armor', 'tool', 'trinket'];
      const worn = slots.filter((x) => eq[x]);
      const empty = slots.length - worn.length;
      html += `<section class="ws-dsec"><h5>Equipment</h5>${worn.length ? '' : '<div class="ws-gearnone">Carries no gear</div>'}<div class="ws-slots">${worn
        .map((slot) => {
          const it = eq[slot];
          const q = String(it.quality || 'common').toLowerCase();
          const mat = it.material ? prettyId(it.material) : '';
          const hist = it.history ? `<em class="ws-slot__hist">${esc(it.history)}</em>` : '';
          return `<div class="ws-slot is-${q}" data-tip="${esc([it.name, mat, prettyId(q), it.power != null ? `power ${it.power}` : ''].filter(Boolean).join(' · '))}"><span class="ws-slot__ico">${uiIcon(SLOT_ICON[it.slot || slot] || 'sparkle')}</span><span class="ws-slot__txt"><b>${esc(it.name || prettyId(it.kind || slot))}</b><small><i class="ws-q"></i>${esc([mat, prettyId(q)].filter(Boolean).join(' · '))}</small>${hist}</span></div>`;
        })
        .join('')}</div>${worn.length && empty ? `<div class="ws-gearnone">${empty} empty slot${empty > 1 ? 's' : ''}</div>` : ''}</section>`;
    }
    const bio = Array.isArray(u.bio) ? u.bio.slice(-10).reverse() : [];
    if (bio.length) {
      html += `<section class="ws-dsec"><h5>Life story</h5><ol class="ws-bio">${bio
        .map((b) => `<li><span class="ws-bio__y">Y${Math.floor((b.t ?? 0) / YEAR) + 1}</span><span class="ws-bio__t">${esc(b.text || '')}</span></li>`)
        .join('')}</ol></section>`;
    }
    return html;
  }
  cultureOf(id) {
    if (!id) return null;
    if (typeof id === 'object') return id;
    const live = safe(() => this.game.civ?.cultureDef?.(id), null);
    if (live) return live;
    const C = this.game.civ?.cultures;
    const found = C instanceof Map ? C.get(id) : Array.isArray(C) ? C.find((c) => c && (c.id === id || c.name === id)) : C?.[id];
    return found || (CULTURES[id] ? { id, name: CULTURES[id].name, traits: CULTURES[id].traits || [] } : { id, name: prettyId(id), traits: [] });
  }
  // People inside or standing in a building (the king in his hall): chips that open their card.
  occupants(b) {
    const U = this.game.units;
    if (!U?.list || b.tx == null) return [];
    const x0 = b.tx - 0.3,
      z0 = b.ty - 0.3,
      x1 = b.tx + (b.w || 1) + 0.3,
      z1 = b.ty + (b.h || 1) + 0.3;
    const cx = (x0 + x1) / 2,
      cz = (z0 + z1) / 2,
      rr = Math.max(x1 - x0, z1 - z0);
    const out = [];
    const take = (u) => {
      if (!u?.alive || u.def?.kind !== 'humanoid' || u.data?.aboard != null) return;
      if (u.x >= x0 && u.x <= x1 && u.z >= z0 && u.z <= z1) out.push(u);
    };
    if (typeof U.forEachNear === 'function') U.forEachNear(cx, cz, rr, (u) => take(u));
    else for (const u of U.list) take(u);
    out.sort((a, b2) => (b2.job === 'king') - (a.job === 'king') || (b2.data?.inside === true) - (a.data?.inside === true));
    return out;
  }
  occupantsHtml(b) {
    const list = safe(() => this.occupants(b), [], 'occupants') || [];
    if (!list.length) return '';
    const chips = list
      .slice(0, 8)
      .map((u) => {
        const job = JOB[u.job] || (u.age < (u.def?.maturity ?? 0) ? JOB.child : null);
        return `<button class="ws-tchip ws-occ" type="button" data-act="occupant" data-uid="${u.id}" style="--tint:${job?.[1] || '#c9b88a'}" aria-label="Show ${esc(u.name || 'this person')}">${uiIcon(job?.[0] || 'spawn-human')}<span>${esc(u.name || job?.[2] || 'Someone')}</span>${uiIcon('chev-right')}</button>`;
      })
      .join('');
    const more = list.length > 8 ? `<span class="ws-insp__muted">+${list.length - 8} more</span>` : '';
    return `<section class="ws-dsec"><h5>Inside · ${list.length}</h5><div class="ws-chips">${chips}${more}</div></section>`;
  }
  // The inspector result for one exact creature (Units.inspect picks the one
  // nearest a point, which may be a neighbour standing on the same spot).
  unitResult(u) {
    const U = this.game.units;
    if (!u || typeof U?.inspect !== 'function') return null;
    if (typeof U.forEachNear !== 'function') return safe(() => U.inspect({ x: u.x, z: u.z }), null, 'unit result');
    const own = Object.prototype.hasOwnProperty.call(U, 'forEachNear');
    const prev = U.forEachNear;
    try {
      U.forEachNear = (x, z, r, fn) => fn(u, 0);
      const res = U.inspect({ x: u.x, z: u.z, tx: Math.floor(u.x), ty: Math.floor(u.z) });
      return res && res.unit === u ? res : null;
    } catch (err) {
      console.warn('[ui] unit result', err);
      return null;
    } finally {
      if (own) U.forEachNear = prev;
      else delete U.forEachNear;
    }
  }
  showUnit(u) {
    if (!u || u.alive === false) return;
    const r = this.unitResult(u);
    this.show({ x: u.x, z: u.z });
    let i = this.results.findIndex((o) => o.unit === u);
    if (i < 0 && r) {
      this.results.unshift(r);
      i = 0;
    }
    if (i >= 0) this.focusIndex(i);
  }
  realmDepth(r) {
    const g = this.game;
    const isKingdom = kindOf(r) === 'kingdom';
    const v = isKingdom ? null : r.village || (r.building ? g.civ?.villages?.[r.building.village] : null);
    const k = (typeof r.kingdom === 'object' && r.kingdom) || (v ? kingdomOf(g, v.kingdom) : null);
    if (!k && !v) return '';
    let html = '';
    if (kindOf(r) === 'building' && r.building) html += this.occupantsHtml(r.building);
    if (isKingdom && k.motto && !(r.stats || []).some((s) => /motto/i.test(String(s[0])))) html += `<p class="ws-motto">“${esc(String(k.motto))}”</p>`;
    if (k && !isKingdom) {
      const era = eraOf(g, k);
      html += `<section class="ws-dsec"><h5>Realm</h5><div class="ws-realm__line"><span class="ws-era is-era${era}">${uiIcon(['house', 'build', 'job-soldier', 'chronicle'][era])}<span>Realm · ${esc(eraNames()[era] || '')} era</span></span><span class="ws-realm__of">${esc(String(k.name || ''))}</span></div></section>`;
    }
    if (k && isKingdom) {
      const era = eraOf(g, k);
      const res = researchOf(g, k);
      const nT = k.techs instanceof Set ? k.techs.size : Array.isArray(k.techs) ? k.techs.length : 0;
      const tot = techList(g).length;
      const mastery = k.mastery || 0;
      html += `<section class="ws-dsec"><h5>Learning</h5><div class="ws-realm__era"><span class="ws-era is-era${era}">${uiIcon(['house', 'build', 'job-soldier', 'chronicle'][era])}<span>${esc(eraNames()[era] || '')} era</span></span>${
        res ? `<span class="ws-realm__res"><small>Studying ${esc(res.name)}${res.pct != null ? ` · ${Math.round(res.pct * 100)}%` : ''}</small>${res.pct != null ? `<span class="ws-meter"><i style="width:${(res.pct * 100).toFixed(1)}%"></i></span>` : ''}</span>` : `<span class="ws-realm__res"><small>${nT && tot && nT >= tot ? 'Every technology is known' : 'No research under way'}</small></span>`
      }</div><div class="ws-realm__facts"><span data-tip="Technologies this realm has learned">${uiIcon('chronicle')}${nT}${tot ? ` / ${tot}` : ''} techs</span>${mastery > 0 ? `<span data-tip="Mastery: refinements earned after every technology is known. Each level adds 3% to work, harvests and building.">${uiIcon('crown')}Mastery ${mastery}</span>` : ''}</div></section>`;
    }
    const cult = this.cultureOf(v?.culture ?? k?.culture);
    if (cult) {
      const traits = (cult.traits || []).map((t) => this.chip(typeof t === 'string' ? prettyId(t) : t.name || prettyId(t.id), typeof t === 'object' ? t.description : '', 'is-culture', 'banner')).join('');
      // villages list their culture mix as a stat row; here only the traits
      const hasMix = (r.stats || []).some((s) => /^culture$/i.test(String(s[0])));
      if (traits || !hasMix) html += `<section class="ws-dsec"><h5>${hasMix ? 'Culture traits' : 'Culture'}</h5><div class="ws-chips">${hasMix ? '' : this.chip(cult.name || prettyId(cult.id), cult.language ? `Tongue: ${cult.language}` : '', 'is-culture-name', 'chronicle')}${traits}</div></section>`;
    }
    const inv = isKingdom ? k?.inventory || null : null;
    // food is already a meter in the stats above, so stores list the rest
    const src = inv || (v ? { wood: v.wood, stone: v.stone, ore: v.ore, gold: v.gold } : null);
    if (src) {
      const cells = Object.entries(INV)
        .filter(([key]) => src[key] != null)
        .map(([key, [icon, label]]) => `<span class="ws-inv" data-tip="${label}">${uiIcon(icon)}<b>${fmtNum(src[key])}</b><small>${label}</small></span>`)
        .join('');
      if (cells) html += `<section class="ws-dsec"><h5>${inv ? 'Kingdom treasury' : 'Village stores'}</h5><div class="ws-invgrid">${cells}</div></section>`;
      if (isKingdom && k) {
        const n = k.techs instanceof Set ? k.techs.size : Array.isArray(k.techs) ? k.techs.length : 0;
        if (n) html += `<section class="ws-dsec"><h5>Latest discoveries</h5><div class="ws-chips">${[...(k.techs instanceof Set ? k.techs : k.techs || [])].slice(-6).map((id) => this.chip(techDef(g, id)?.name || prettyId(id), techDef(g, id)?.description || '', 'is-tech', 'good')).join('')}</div></section>`;
      }
    }
    const ruler = k && isKingdom ? g.units?.byId?.get?.(k.ruler) : null;
    if (ruler && Array.isArray(ruler.traits) && ruler.traits.length) {
      html += `<section class="ws-dsec"><h5>Ruler · ${esc(ruler.name || k.rulerName || '')}</h5><div class="ws-chips">${this.traitChips(ruler.traits)}</div></section>`;
    }
    return html;
  }

  signature() {
    const r = this.track;
    const u = r?.unit;
    const st = u?.statuses instanceof Map ? [...u.statuses.keys()] : u?.statuses ? Object.keys(u.statuses) : null;
    const eq = u?.equipment ? Object.values(u.equipment).map((i) => i?.name || i?.id || 0) : null;
    const k = typeof r?.kingdom === 'object' ? r.kingdom : null;
    const keys = (r?.stats || []).map((s) => s?.[0]);
    return r ? JSON.stringify([r.title, r.subtitle, keys, u?.alive, this.game.cameraRig.follow === u, this.results.map((o) => o.title), u?.job, u?.traits, st, eq, u?.level, u?.bio?.length, u?.data?.favorite, u?.flags, u?.name, k ? [k.motto, k.color, k.name, k.banner?.symbol, k.banner?.field] : null, k?.era, k?.researching, k?.techs?.size, !!(u || r.building) && !!this.portraits.get(u || r.building), this.isCompact(), kindOf(r) === 'building' && r.building ? safe(() => this.occupants(r.building).map((o) => o.id).join(','), '') : '']) : '';
  }
  valueSignature() {
    const r = this.track;
    const u = r?.unit;
    const st = u?.statuses instanceof Map ? [...u.statuses.values()].map((v) => Math.ceil(v)) : null;
    return r ? JSON.stringify([r.stats, st]) : '';
  }
  // Update live values in place (no innerHTML rewrite: taps and popovers survive).
  patchValues() {
    const r = this.track;
    if (!r) return;
    for (const s of r.stats || []) {
      if (!Array.isArray(s) || s.length < 2) continue;
      const cell = this.el.querySelector(`.ws-cell[data-k="${CSS.escape(String(s[0]))}"]`);
      if (!cell) continue;
      let v = s[1];
      if (typeof v === 'string' && /^[a-z]/.test(v)) v = v[0].toUpperCase() + v.slice(1);
      const m = this.meter(v);
      const shown = m != null && /\(\s*[\d.]+%\s*\)\s*$/.test(String(v)) ? String(v).replace(/\s*\(\s*[\d.]+%\s*\)\s*$/, '') : String(v);
      const ve = cell.querySelector('.ws-cell__v');
      if (ve && ve.textContent !== shown) ve.textContent = shown;
      const bar = cell.querySelector('.ws-meter i');
      if (bar && m != null) bar.style.width = (m * 100).toFixed(1) + '%';
    }
    const u = r.unit;
    if (u?.statuses instanceof Map)
      for (const [id, secs] of u.statuses) {
        const sm = this.el.querySelector(`.ws-tchip[data-st="${CSS.escape(id)}"] small`);
        if (sm && Number.isFinite(secs)) sm.textContent = secs >= YEAR ? `${Math.ceil(secs / YEAR)}y` : `${Math.ceil(secs)}s`;
      }
    this._vsig = this.valueSignature();
  }
  // No structural re-render while a finger/pointer is down in the panel or a popover is open on it.
  frozen() {
    const pop = this.ui.popover;
    return !!this._ptr || !!(pop?.target && pop.el.classList.contains('is-shown') && this.el.contains(pop.target));
  }

  toggleFollow() {
    const u = this.track?.unit || (isCraft(this.track) ? this.track.vessel || this.track.building : null);
    if (!u || u.alive === false || u.state === 'sinking') return;
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

  isCompact() {
    return matchMedia('(max-width: 720px), (max-height: 500px)').matches;
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

  editTarget(r) {
    if (!r) return null;
    if (r.unit) return r.unit;
    if (kindOf(r) === 'kingdom') return typeof r.kingdom === 'object' ? r.kingdom : null;
    return r.village || this.game.civ?.villages?.[r.building?.village] || null;
  }
  stopEdit() {
    if (!this.editing) return;
    this.editing = null;
    this._sig = '';
    this.render();
  }
  // portrait arrived while editing: drop it into the header, leave the card alone
  patchPortrait(url) {
    const b = this.el.querySelector('.ws-insp__badge');
    if (!b || b.querySelector('.ws-insp__portrait')) return;
    const img = document.createElement('img');
    img.className = 'ws-insp__portrait';
    img.src = url;
    img.alt = '';
    const svg = b.querySelector(':scope > svg');
    b.classList.add('has-portrait');
    if (svg) {
      const glyph = document.createElement('span');
      glyph.className = 'ws-insp__glyph';
      svg.replaceWith(img);
      glyph.append(svg);
      img.after(glyph);
    } else b.prepend(img);
  }
  // After an edit (or its Undo): re-query the subject and refresh the header in
  // place (title, subtitle such as "banner of Maroon", crest, banner badge),
  // leaving the edit card untouched.
  patchHeader() {
    const r0 = this.track;
    if (!r0 || !this.hit) return;
    const k0 = kindOf(r0);
    const tgt = this.editTarget(r0);
    const list = safe(() => this.collect(this.hit), null) || [];
    const r = list.find((o) => kindOf(o) === k0 && (r0.unit ? o.unit === r0.unit : r0.building ? o.building === r0.building : this.editTarget(o) === tgt));
    if (!r) return;
    this.results = list;
    this.index = list.indexOf(r);
    this.track = r;
    const h = this.el.querySelector('.ws-insp__title');
    if (h && h.firstChild) h.firstChild.textContent = r.title || '';
    if (h) this.sizeTitle(h, r.title);
    const sub = this.el.querySelector('.ws-insp__sub span');
    if (sub && r.subtitle) sub.textContent = this.subText(r);
    const tint = this.kingdomTint(r);
    if (tint) this.el.querySelectorAll('.ws-insp__head .ws-crest, .ws-insp__kdot').forEach((i) => i.style.setProperty('--k', tint));
    const kObj = kindOf(r) === 'kingdom' && typeof r.kingdom === 'object' ? r.kingdom : null;
    const hb = kObj?.banner && this.el.querySelector('.ws-insp__badge.has-banner .ws-insp__portrait');
    if (hb) hb.src = bannerURL(kObj.banner, kObj.color, 72);
    const pin = this.pin?.querySelector('.ws-pin__label');
    if (pin) pin.textContent = r.title || '';
    this._sig = this.signature();
  }
  // subtitle with a custom realm colour named plainly ("banner of deep teal")
  subText(r) {
    const k = typeof r.kingdom === 'object' && r.kingdom ? r.kingdom : null;
    if (k) return realmColourText(r.subtitle, k.color);
    // carts and caravans rest in a village; only ships lie in port
    const c = isCraft(r) ? r.vessel || r.building : null;
    if (c && c.cls === 'land') return String(r.subtitle || '').replace(' · in port at ', ' · resting at ');
    return r.subtitle;
  }
  // long names step down a size instead of breaking mid-word
  sizeTitle(h, title) {
    const n = String(title || '').length;
    h.classList.toggle('is-long', n > 16 && n <= 24);
    h.classList.toggle('is-vlong', n > 24);
  }
  // after a rename: update the header without touching the edit card
  patchTitle(text) {
    // a village edited from one of its buildings keeps the building's title
    if (kindOf(this.track) === 'building') return;
    const h = this.el.querySelector('.ws-insp__title');
    if (h && h.firstChild) h.firstChild.textContent = text;
    this.pin.querySelector('.ws-pin__label').textContent = text;
  }

  // Re-query the tracked entity so stats stay live.
  refresh() {
    const r = this.track;
    if (!r) return;
    if (this.editing) {
      // never rebuild the card under the player; leave edit mode only if the subject is gone
      if (this.editing.alive === false) this.stopEdit();
      return;
    }
    const u = r.unit,
      b = r.building;
    let at = this.hit;
    if (u) at = { x: u.x, z: u.z, tx: Math.floor(u.x), ty: Math.floor(u.z) };
    else if (b && b.x != null) at = { x: b.x, z: b.z, tx: Math.floor(b.x), ty: Math.floor(b.z) };
    const list = this.collect(at);
    let idx = list.findIndex((o) => (u && o.unit === u) || (b && o.building === b) || (!u && !b && kindOf(o) === kindOf(r) && o.title === r.title));
    if (idx < 0 && u && u.alive !== false) {
      const own = this.unitResult(u);
      if (own) {
        list.unshift(own);
        idx = 0;
      }
    }
    if (idx < 0) {
      if (isCraft(r)) {
        if (!this._deadShown) {
          this._deadShown = true;
          if (this.game.cameraRig.follow === b) this.game.cameraRig.follow = null;
          this.render();
        }
        return;
      }
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
    if (this.signature() !== this._sig) {
      if (this.frozen()) this._pending = true;
      else {
        this._pending = false;
        this.render();
      }
    } else if (this.valueSignature() !== this._vsig) this.patchValues();
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
    // keep the pin out of every HUD panel (top bar, dock, overview, map, ...)
    const now = performance.now();
    if (!this._hudRects || now - this._hudT > 500) {
      this._hudT = now;
      this._hudRects = [...this.ui.root.querySelectorAll('.ws-brand, .ws-clock, .ws-stats, .ws-agechip, .ws-dock__panel, .ws-brush.is-shown, .ws-overview, .ws-mapwrap:not(.is-off), .ws-insp.is-open, .ws-side.is-open, .ws-campad, .ws-feed__item')]
        .map((e) => e.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.height > 0);
    }
    const lw0 = pin.firstChild.offsetWidth || 60;
    const box = { l: x - Math.max(10, lw0 / 2) - 4, r: x + Math.max(10, lw0 / 2) + 4, t: sy - 42, b: sy + 2 };
    if (this._hudRects.some((r) => box.l < r.right && box.r > r.left && box.t < r.bottom && box.b > r.top)) {
      pin.classList.remove('is-shown');
      return;
    }
    pin.style.transform = `translate(${x.toFixed(1)}px, ${sy.toFixed(1)}px)`;
    const lab = pin.firstChild;
    const lw = lab.offsetWidth || 0;
    const shift = Math.max(8, Math.min(innerWidth - 8 - lw, x - lw / 2)) - (x - lw / 2);
    lab.style.transform = `translateX(calc(-50% + ${shift.toFixed(0)}px))`;
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
